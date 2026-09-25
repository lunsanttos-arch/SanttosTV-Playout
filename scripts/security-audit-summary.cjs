"use strict";
const fs = require("node:fs");

function summarize(filename, heading) {
    const report = JSON.parse(fs.readFileSync(filename, "utf8"));
    const counts = report.metadata?.vulnerabilities ?? {};
    console.log("\n== "+heading+" ==");
    console.log("Total: "+(counts.total??"?")+" | Criticas: "+(counts.critical??0)+" | Altas: "+(counts.high??0)+" | Moderadas: "+(counts.moderate??0)+" | Baixas: "+(counts.low??0));
    for (const [name, detail] of Object.entries(report.vulnerabilities ?? {})) {
        const via = (detail.via ?? [])
          .map(x => typeof x === "string" ? x : (x.title || x.name)).slice(0, 3).join(" | ");
        const fix = detail.fixAvailable === true ? "update available"
          : detail.fixAvailable === false ? "no automated fix"
          : JSON.stringify(detail.fixAvailable);
        console.log(JSON.stringify({package:name,severity:detail.severity,direct:detail.isDirect,range:detail.range,affectedBy:detail.effects,via,fix}));
    }
}
summarize("audit-all.json","Todas as dependencias");
summarize("audit-production.json","Somente dependencias de producao");
