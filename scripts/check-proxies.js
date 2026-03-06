#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ProxyAgent } = require('undici');
// Luôn sync với crawler/proxy.js — không cần hardcode lại ở đây
const { PROXY_IPS } = require('../crawler/proxy');

const user = process.env.PROXY_USER;
const pass = process.env.PROXY_PASS;
const port = process.env.PROXY_PORT || '50100';

async function testProxy(ip) {
    const proxyUrl = `http://${user}:${pass}@${ip}:${port}`;
    const dispatcher = new ProxyAgent(proxyUrl);
    const start = Date.now();
    try {
        const res = await fetch('https://api.ipify.org?format=json', {
            dispatcher,
            signal: AbortSignal.timeout(8000),
        });
        const json = await res.json();
        const ms = Date.now() - start;
        return { ip, ok: true, outIp: json.ip, ms };
    } catch (err) {
        return { ip, ok: false, error: err.message.slice(0, 80), ms: Date.now() - start };
    }
}

(async () => {
    console.log(`Testing ${PROXY_IPS.length} proxies in parallel...\n`);
    const results = await Promise.all(PROXY_IPS.map(ip => testProxy(ip)));

    const alive = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms);
    const dead  = results.filter(r => !r.ok);

    console.log(`=== ALIVE (${alive.length}) ===`);
    alive.forEach(r => {
        console.log(`  OK   ${r.ip.padEnd(18)} → ${r.outIp.padEnd(18)} (${r.ms}ms)`);
    });

    if (dead.length) {
        console.log(`\n=== DEAD (${dead.length}) ===`);
        dead.forEach(r => {
            console.log(`  DIE  ${r.ip.padEnd(18)} ${r.error}`);
        });
    }

    console.log(`\nSummary: ${alive.length}/${results.length} alive`);
    process.exit(0);
})();
