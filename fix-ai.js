const fs = require("fs");
const path = "./api/_services/ai.ts";
let content = fs.readFileSync(path, "utf-8");
content = content.split("\\`").join("`");
content = content.split("\\${").join("${");
content = content.split("\\\\s*").join("\\s*");
fs.writeFileSync(path, content, "utf-8");
console.log("Fixed ai.ts with split/join");
