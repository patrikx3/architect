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

const DEFAULT_LIMITS = {
    maxFileBytes: 200 * 1024,
    maxTotalBytes: 2 * 1024 * 1024,
    maxFiles: 200,
};

function isLikelyBinary(buffer) {
    const slice = buffer.subarray(0, 1024);
    for (let i = 0; i < slice.length; i += 1) if (slice[i] === 0) return true;
    return false;
}

export async function scanProject(projectRoot, limits = {}) {
    const cap = { ...DEFAULT_LIMITS, ...limits };
    const files = [];
    const paths = []; // every non-ignored file path (even when content was skipped)
    let totalBytes = 0;
    let truncated = false;
    const skipped = { binary: 0, tooLarge: 0, ignored: 0 };

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
            // The path list keeps growing past content limits so the architect still
            // sees the full layout (e.g. src-server/layer/express/api/admin/) even if
            // content for those files was too big to send.
            if (truncated) continue;
            let st;
            try { st = await stat(full); } catch { continue; }
            if (st.size > cap.maxFileBytes) { skipped.tooLarge += 1; continue; }
            let buf;
            try { buf = await readFile(full); } catch { continue; }
            if (isLikelyBinary(buf)) { skipped.binary += 1; continue; }
            const content = buf.toString('utf8');
            files.push({ path: rel, content });
            totalBytes += content.length;
            if (files.length >= cap.maxFiles || totalBytes >= cap.maxTotalBytes) {
                truncated = true;
            }
        }
    }

    await walk(projectRoot);

    paths.sort();
    const hasCode = paths.some((p) => SOURCE_EXT.test(p));
    return {
        files,
        paths,
        hasCode,
        truncated,
        totalBytes,
        skipped,
    };
}
