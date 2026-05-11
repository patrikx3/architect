import path from 'node:path';
import fsExtra from 'fs-extra';

const { readdir, readFile, stat } = fsExtra;

// Directories the architect should never look at. Either tooling/build noise or
// the architect's own outputs (agents/) and publish flow (secure/).
const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
    '.next', '.cache', '.turbo', '.parcel-cache', '.svelte-kit', '.nuxt',
    '.angular', '.expo', '.idea', '.vscode',
    'agents', 'secure',
    '__pycache__', '.pytest_cache', '.venv', 'venv', 'env',
    'target', 'vendor', 'tmp', 'temp', 'logs',
]);

const IGNORE_FILES = new Set([
    'yarn.lock', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lockb',
    'Cargo.lock', 'Gemfile.lock', 'composer.lock', 'poetry.lock',
    '.DS_Store', 'Thumbs.db',
]);

const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|html|css|scss|sass|vue|svelte|sql|sh|yaml|yml|toml)$/i;

// Files that are almost always central / wiring / manifests. The smart-picker
// always includes these regardless of normal budget.
const WIRING_FILENAME_RX = /^(registry|index|main|app|server|config|bootstrap|module|kernel|application|router|routes|store|state)\.(mjs|cjs|js|ts|tsx|jsx|php|py|rb|go|rs|java|kt|cs)$/i;
const MANIFEST_RX = /^(package\.json|composer\.json|pyproject\.toml|cargo\.toml|go\.mod|gemfile|build\.gradle|pom\.xml|tsconfig\.json|vite\.config\.(m?js|ts)|webpack\.config\.(m?js|ts)|README\.md|AGENTS\.md|CLAUDE\.md)$/i;

const DEFAULT_LIMITS = {
    maxFileBytes: 200 * 1024,
    maxTotalBytes: 4 * 1024 * 1024,
    maxFiles: 400,
    // Smart-picker exemplar budget — separate from the main budget, allocated
    // to ensure each detected file-name cluster has at least one representative
    // in `files`. These are added IN ADDITION to whatever fit in maxTotalBytes.
    smartPickerMaxBytes: 1 * 1024 * 1024,
    smartPickerPerCluster: 2,
};

function isLikelyBinary(buffer) {
    const slice = buffer.subarray(0, 1024);
    for (let i = 0; i < slice.length; i += 1) if (slice[i] === 0) return true;
    return false;
}

// Compute "cluster keys" for a path. A path can belong to multiple clusters.
// Used by the smart-picker to guarantee at least one exemplar per cluster.
function clusterKeysFor(p) {
    const keys = [];
    const base = path.basename(p);
    const dir = path.dirname(p);

    // Sub-extension suffix: ".queue.mjs", ".schema.mjs", ".controller.php", etc.
    // Catches the common ".<role>.<ext>" pattern many codebases use to mark
    // file roles (Bull queues, Mongoose schemas, NestJS controllers, …).
    const dotParts = base.split('.');
    if (dotParts.length > 2) {
        const suffix = '.' + dotParts.slice(-2).join('.');
        keys.push(`suffix:${suffix}`);
    }

    // Underscore-based role suffix: "Foo_model.php", "user_helper.php" (CodeIgniter)
    // or "FooModel.cs", "UserService.java" (PascalCase role suffix). We extract the
    // trailing role token (lowercase) and cluster on it + extension.
    const ext = path.extname(base);
    const baseName = base.slice(0, base.length - ext.length);
    const underscoreMatch = baseName.match(/_([a-zA-Z]+)$/);
    if (underscoreMatch) {
        keys.push(`role-suffix:_${underscoreMatch[1].toLowerCase()}${ext}`);
    } else {
        // PascalCase role suffix: split on capital boundaries, take last token
        const pascalMatch = baseName.match(/([A-Z][a-z]+)$/);
        if (pascalMatch && /^[A-Z][a-zA-Z]+$/.test(baseName)) {
            keys.push(`role-suffix:${pascalMatch[1]}${ext}`);
        }
    }

    // Parent directory (only when meaningful — depth ≥ 2)
    const dirParts = dir.split('/').filter(Boolean);
    if (dirParts.length >= 2) {
        // Use the deepest 2 segments — captures "src-server/layer/mongoose/schema"
        // down to "schema" but groups all files under it.
        keys.push(`dir:${dirParts.slice(-2).join('/')}`);
    } else if (dirParts.length === 1) {
        keys.push(`dir:${dirParts[0]}`);
    }

    // Plain extension fallback (e.g. ".vue", ".svelte")
    if (ext) keys.push(`ext:${ext}`);

    // Special: wiring files
    if (WIRING_FILENAME_RX.test(base)) keys.push('special:wiring');
    if (MANIFEST_RX.test(base)) keys.push('special:manifest');

    return keys;
}

function buildClusters(paths) {
    const clusters = new Map(); // key -> [path,...]
    for (const p of paths) {
        for (const key of clusterKeysFor(p)) {
            if (!clusters.has(key)) clusters.set(key, []);
            clusters.get(key).push(p);
        }
    }
    return clusters;
}

// Pick exemplars from each cluster (round-robin, smallest-first to save budget).
// Always includes all special:wiring and special:manifest. Returns a Set of paths.
function smartPickExemplars(clusters, sizesByPath, alreadyIncluded, opts) {
    const picked = new Set();
    let bytesPlanned = 0;
    const cap = opts.smartPickerMaxBytes;
    const perCluster = opts.smartPickerPerCluster;

    const tryAdd = (p) => {
        if (alreadyIncluded.has(p) || picked.has(p)) return false;
        const sz = sizesByPath.get(p) ?? 0;
        if (sz === 0 || sz > opts.maxFileBytes) return false;
        if (bytesPlanned + sz > cap) return false;
        picked.add(p);
        bytesPlanned += sz;
        return true;
    };

    // 1) Always include every wiring + manifest file (within file-size cap).
    for (const key of ['special:wiring', 'special:manifest']) {
        const members = clusters.get(key) ?? [];
        for (const p of members) tryAdd(p);
    }

    // 2) For each remaining cluster, pick up to perCluster smallest unpicked
    //    files. Process clusters in order of size (small clusters first — they
    //    are usually the most distinctive patterns; huge clusters like ".mjs"
    //    are dominated by file content variability).
    const orderedClusters = Array.from(clusters.entries())
        .filter(([k]) => !k.startsWith('special:'))
        .sort((a, b) => a[1].length - b[1].length);

    for (let round = 0; round < perCluster; round += 1) {
        for (const [, members] of orderedClusters) {
            // Pick the smallest unpicked member of this cluster
            const sorted = members
                .filter((p) => !alreadyIncluded.has(p) && !picked.has(p))
                .sort((a, b) => (sizesByPath.get(a) ?? 0) - (sizesByPath.get(b) ?? 0));
            if (sorted.length === 0) continue;
            if (!tryAdd(sorted[0])) break; // budget exhausted
        }
        if (bytesPlanned >= cap) break;
    }

    return picked;
}

export async function scanProject(projectRoot, limits = {}) {
    const cap = { ...DEFAULT_LIMITS, ...limits };
    const files = [];
    const paths = []; // every non-ignored file path (even when content was skipped)
    const sizesByPath = new Map();
    let totalBytes = 0;
    let truncated = false;
    const skipped = { binary: 0, tooLarge: 0, ignored: 0 };
    const includedSet = new Set(); // tracks which paths got content embedded

    async function walk(dir) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (IGNORE_DIRS.has(entry.name)) { skipped.ignored += 1; continue; }
                if (entry.name.startsWith('.') && entry.name !== '.github') { skipped.ignored += 1; continue; }
                await walk(full);
                continue;
            }
            if (!entry.isFile()) continue;
            if (IGNORE_FILES.has(entry.name)) { skipped.ignored += 1; continue; }
            if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.npmignore' && entry.name !== '.env.example') {
                skipped.ignored += 1;
                continue;
            }
            const rel = path.relative(projectRoot, full).split(path.sep).join('/');
            paths.push(rel);
            let st;
            try { st = await stat(full); } catch { continue; }
            sizesByPath.set(rel, st.size);

            // Phase 1: alphabetical fill (existing behaviour) — only while under
            // budget. The smart-picker pass below covers the rest.
            if (truncated) continue;
            if (st.size > cap.maxFileBytes) { skipped.tooLarge += 1; continue; }
            let buf;
            try { buf = await readFile(full); } catch { continue; }
            if (isLikelyBinary(buf)) { skipped.binary += 1; continue; }
            const content = buf.toString('utf8');
            files.push({ path: rel, content });
            includedSet.add(rel);
            totalBytes += content.length;
            if (files.length >= cap.maxFiles || totalBytes >= cap.maxTotalBytes) {
                truncated = true;
            }
        }
    }

    await walk(projectRoot);

    paths.sort();
    const hasCode = paths.some((p) => SOURCE_EXT.test(p));

    // Phase 2: smart-picker — ensure each detected cluster has an exemplar in `files`.
    // This is what gives the scout role enough material to describe conventions
    // even when the alphabetical walk filled budget before reaching key files.
    const clusters = buildClusters(paths);
    const exemplarPicks = smartPickExemplars(clusters, sizesByPath, includedSet, cap);
    const exemplars = [];
    for (const p of exemplarPicks) {
        try {
            const full = path.join(projectRoot, p);
            const buf = await readFile(full);
            if (isLikelyBinary(buf)) continue;
            const content = buf.toString('utf8');
            files.push({ path: p, content });
            exemplars.push(p);
            includedSet.add(p);
            totalBytes += content.length;
        } catch {
            /* skip unreadable */
        }
    }

    // Build a lightweight cluster summary the scout role can use (and the
    // orchestrator can log).
    const clusterSummary = [];
    for (const [key, members] of clusters) {
        if (key.startsWith('special:')) continue;
        clusterSummary.push({ key, size: members.length });
    }
    clusterSummary.sort((a, b) => b.size - a.size);

    return {
        files,
        paths,
        hasCode,
        truncated,
        totalBytes,
        skipped,
        exemplars,            // paths added by smart-picker (in addition to alphabetical fill)
        clusters: clusterSummary, // { key, size } pairs, sorted by size desc
    };
}
