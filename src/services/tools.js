const fs = require("fs");
const path = require("path");

// Global workspace path (can be set from extension)
let WORKSPACE_PATH = null;

// Function to set workspace path
function setWorkspacePath(workspacePath) {
    WORKSPACE_PATH = workspacePath;
    console.log(`🏠 Workspace path set to: ${WORKSPACE_PATH}`);
}

// Function to get workspace path
function getWorkspacePath() {
    return WORKSPACE_PATH;
}

// Function to resolve path (relative to workspace or absolute)
function resolvePath(filePath) {
    if (!filePath) return null;

    // If it's already absolute, return as is
    if (path.isAbsolute(filePath)) {
        return filePath;
    }

    // If workspace path is set, resolve relative to it
    if (WORKSPACE_PATH) {
        return path.join(WORKSPACE_PATH, filePath);
    }

    // Otherwise return the path as is
    return filePath;
}

// Polyfill fetch for Node.js if not available
if (typeof global !== "undefined" && !global.fetch) {
    try {
        // Try using undici (built-in with Node.js 18+)
        const { fetch: undiciFetch } = require("undici");
        global.fetch = undiciFetch;
    } catch {
        try {
            // Fallback to node-fetch if available
            global.fetch = require("node-fetch");
        } catch {
            console.warn("⚠️ No fetch polyfill available. Using default.");
        }
    }
}

// TOOL FUNCTIONS
async function cryptoPrice({ coinName }) {
    try {
        const res = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${coinName.toLowerCase()}`
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const [data] = await res.json();

        return {
            coin_name: data?.name ?? null,
            symbol: data?.symbol ?? null,
            price_inr: data?.current_price ?? null,
        };
    } catch (error) {
        console.error("cryptoPrice error:", error.message);
        throw error;
    }
}

async function getCurrentTime() {
    return {
        time: new Date().toUTCString(),
        timestamp: new Date().getTime(),
    };
}

async function listFiles({ directory = "." }) {
    try {
        // Resolve path relative to workspace
        const resolvedPath = resolvePath(directory || ".");

        if (!resolvedPath) {
            return { error: "Directory path is required" };
        }

        // Check if directory exists
        if (!fs.existsSync(resolvedPath)) {
            return { error: `Directory not found: ${resolvedPath}` };
        }

        const files = [];
        const extensions = [".js", ".jsx", ".ts", ".tsx", ".html", ".css"];

        function scan(dir) {
            try {
                const items = fs.readdirSync(dir);

                for (const item of items) {
                    const fullPath = path.join(dir, item);

                    // Skip node_modules, dist, build, .git, etc
                    if (
                        fullPath.includes("node_modules") ||
                        fullPath.includes("dist") ||
                        fullPath.includes("build") ||
                        fullPath.includes(".git")
                    )
                        continue;

                    const stat = fs.statSync(fullPath);

                    if (stat.isDirectory()) {
                        scan(fullPath);
                    } else if (stat.isFile()) {
                        const ext = path.extname(item);
                        if (extensions.includes(ext)) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (err) {
                console.warn(`⚠️ Error scanning ${dir}:`, err.message);
            }
        }

        scan(resolvedPath);
        console.log(`✅ Found ${files.length} files in ${resolvedPath}`);
        return { files, count: files.length, workspace: WORKSPACE_PATH };
    } catch (error) {
        console.error("listFiles error:", error.message);
        return { error: `Failed to list files: ${error.message}` };
    }
}

async function readFile({ file_path }) {
    try {
        if (!file_path) {
            return { error: "File path is required" };
        }

        // Resolve path relative to workspace
        const resolvedPath = resolvePath(file_path);

        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
            return { error: `File not found: ${resolvedPath}` };
        }

        // Check if it's a file (not a directory)
        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
            return { error: `Path is not a file: ${resolvedPath}` };
        }

        const content = fs.readFileSync(resolvedPath, "utf-8");
        const lines = content.split("\n").length;
        console.log(
            `📖 Reading: ${resolvedPath} (${lines} lines, ${content.length} bytes)`
        );
        return {
            content,
            fileName: path.basename(resolvedPath),
            filePath: resolvedPath,
            lines,
            bytes: content.length,
        };
    } catch (error) {
        console.error("readFile error:", {
            file_path,
            message: error.message,
        });
        return { error: `Failed to read file: ${error.message}` };
    }
}

async function writeFile({ file_path, content }) {
    try {
        if (!file_path) {
            return { error: "File path is required" };
        }

        if (content === undefined || content === null) {
            return { error: "Content is required" };
        }

        // Resolve path relative to workspace
        const resolvedPath = resolvePath(file_path);

        // Create directory if it doesn't exist
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }

        // Check if file already exists
        const fileExists = fs.existsSync(resolvedPath);

        fs.writeFileSync(resolvedPath, content, "utf-8");
        const lines = content.split("\n").length;
        console.log(
            `✍️ ${
                fileExists ? "Updated" : "Created"
            }: ${resolvedPath} (${lines} lines, ${content.length} bytes)`
        );

        return {
            success: true,
            fileName: path.basename(resolvedPath),
            path: resolvedPath,
            lines,
            bytes: content.length,
            action: fileExists ? "updated" : "created",
        };
    } catch (error) {
        console.error("writeFile error:", {
            file_path,
            message: error.message,
        });
        return { error: `Failed to write file: ${error.message}` };
    }
}

// EXPORT TOOLS REGISTRY
module.exports = {
    cryptoPrice,
    getCurrentTime,
    listFiles,
    readFile,
    writeFile,
    setWorkspacePath,
    getWorkspacePath,
};
