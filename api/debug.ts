export default async function handler(req: any, res: any) {
  return res.status(200).json({
    nodeVersion: process.version,
    envKeys: Object.keys(process.env).filter(k => !k.includes("KEY") && !k.includes("SECRET") && !k.includes("PASSWORD")),
    hasFetch: typeof fetch !== "undefined",
    hasResponse: typeof Response !== "undefined",
    hasHeaders: typeof Headers !== "undefined",
    arch: process.arch,
    platform: process.platform
  });
}
