import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import url from "url";

// Custom Vite plugin to run local Vercel serverless functions in the Vite dev server
function apiDevServerPlugin() {
  return {
    name: "api-dev-server",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url && req.url.startsWith("/api/")) {
          const parsedUrl = url.parse(req.url, true);
          const pathname = parsedUrl.pathname || "";

          // Map path directly to local directory files (e.g. /api/lender/create -> ./api/lender/create.ts)
          const possiblePaths = [
            path.join(process.cwd(), pathname + ".ts"),
            path.join(process.cwd(), pathname + ".js"),
            path.join(process.cwd(), pathname, "index.ts"),
            path.join(process.cwd(), pathname, "index.js"),
          ];

          let filePath = "";
          for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
              filePath = p;
              break;
            }
          }

          // Fallback: resolve Vercel-style dynamic segments (e.g. /api/deals/123 → api/deals/[id].ts).
          // Walks the path, and where a literal segment file/dir is missing, tries a single
          // `[param].ts` / `[param]/` at that level, capturing the value into req.query.
          const dynamicParams: Record<string, string> = {};
          if (!filePath) {
            const segments = pathname.replace(/^\/+|\/+$/g, "").split("/"); // e.g. ["api","deals","123"]
            let dir = process.cwd();
            let ok = true;
            for (let i = 0; i < segments.length; i++) {
              const seg = segments[i];
              const isLast = i === segments.length - 1;
              const literalDir = path.join(dir, seg);
              const literalFile = path.join(dir, seg + ".ts");
              if (isLast && fs.existsSync(literalFile)) { filePath = literalFile; break; }
              if (isLast && fs.existsSync(path.join(literalDir, "index.ts"))) { filePath = path.join(literalDir, "index.ts"); break; }
              if (!isLast && fs.existsSync(literalDir)) { dir = literalDir; continue; }
              // try a dynamic [param] entry at this level
              const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
              const dynMatch = entries.find((e: string) => /^\[.+\]\.ts$/.test(e) || /^\[.+\]$/.test(e));
              if (!dynMatch) { ok = false; break; }
              const param = dynMatch.replace(/^\[|\]\.ts$|\]$/g, "");
              dynamicParams[param] = decodeURIComponent(seg);
              if (isLast && dynMatch.endsWith(".ts")) { filePath = path.join(dir, dynMatch); break; }
              dir = path.join(dir, dynMatch);
              if (isLast && fs.existsSync(path.join(dir, "index.ts"))) { filePath = path.join(dir, "index.ts"); }
            }
            if (!ok) filePath = "";
          }

          if (!filePath) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: `API route not found: ${pathname}` }));
            return;
          }

          // Parse POST/PUT request bodies
          let body = "";
          if (!pathname.startsWith("/api/inngest") && (req.method === "POST" || req.method === "PUT")) {
            await new Promise((resolve) => {
              req.on("data", (chunk: any) => {
                body += chunk;
              });
              req.on("end", () => {
                resolve(body);
              });
            });
            try {
              if (req.headers["content-type"]?.includes("application/json")) {
                (req as any).body = JSON.parse(body);
              } else {
                (req as any).body = body;
              }
            } catch (e) {
              (req as any).body = body;
            }
          }

          // Attach query parameters and helpers to request/response
          (req as any).query = { ...parsedUrl.query, ...dynamicParams };

          (res as any).json = (data: any) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(data));
          };

          (res as any).status = (code: number) => {
            res.statusCode = code;
            return res;
          };

          try {
            // Dynamically transpile and load TS file using Vite's SSR compiler context
            const module = await server.ssrLoadModule(filePath);
            const handler = module.default;
            if (typeof handler === "function") {
              await handler(req, res);
            } else {
              res.statusCode = 500;
              res.end(`Default export is not a function in ${filePath}`);
            }
          } catch (err: any) {
            console.error(`Error in API handler ${pathname}:`, err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err.message, stack: err.stack, type: err.type }));
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  return {
    plugins: [react(), apiDevServerPlugin()],
  };
});
