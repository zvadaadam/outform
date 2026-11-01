import { describe, expect, test } from "bun:test";
import { isPublicAddress, publicFetch } from "../../src/utils/public-fetch";

const blocked = [
  "0.0.0.0",
  "10.1.2.3",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "192.0.2.1",
  "198.18.0.1",
  "224.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "::ffff:127.0.0.1",
  "fc00::1",
  "fe80::1",
  "ff02::1",
  "2001:db8::1",
  "2002:7f00:1::",
  "3fff::1",
];

describe("public media network policy", () => {
  test.each(blocked)("rejects %s", (address) => expect(isPublicAddress(address)).toBe(false));
  test.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "accepts %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );

  test("does not connect to a loopback image server, including alternate IP notation", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        requests++;
        return new Response("private image");
      },
    });
    try {
      for (const host of ["127.0.0.1", "2130706433", "0x7f000001", "[::ffff:127.0.0.1]"])
        await expect(
          publicFetch(`http://${host}:${server.port}/image`, { signal: AbortSignal.timeout(1000) }),
        ).rejects.toThrow("private or reserved");
      expect(requests).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("validates DNS and redirect destinations before connecting", async () => {
    const moduleSource = new Bun.Transpiler({ loader: "ts" }).transformSync(
      await Bun.file("src/utils/public-fetch.ts").text(),
    );
    const moduleUrl = "data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64");
    const script = `
      import dns from 'node:dns';
      import http from 'node:http';
      import { syncBuiltinESMExports } from 'node:module';
      import { EventEmitter } from 'node:events';
      import { Readable } from 'node:stream';
      const connected = [], resolved = [];
      dns.lookup = (host, options, callback) => {
        resolved.push(host);
        callback(null, host === 'private.example' ? [{address:'10.0.0.1',family:4}] : host === 'mixed.example' ? [{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}] : [{address:'93.184.216.34',family:4}]);
      };
      http.request = (options, onResponse) => {
        const req = new EventEmitter();
        req.end = () => {
          connected.push({host:options.hostname,identity:options.headers.Host});
          const response = Readable.from([Buffer.from('image bytes')]);
          response.statusCode = options.path === '/ok' ? 200 : 302;
          response.headers = response.statusCode === 200 ? {'content-type':'image/png'} : {location:options.path === '/literal' ? 'http://127.0.0.1/secret' : 'http://private.example/secret'};
          onResponse(response);
        };
        return req;
      };
      syncBuiltinESMExports();
      const {publicFetch} = await import(${JSON.stringify(moduleUrl)});
      const errors = [];
      for (const url of ['http://public.example/literal','http://public.example/dns','http://mixed.example/ok']) {
        try { await publicFetch(url, {signal:AbortSignal.timeout(1000)}); } catch(error) { errors.push(error.message); }
      }
      const good = await publicFetch('http://public.example/ok', {signal:AbortSignal.timeout(1000)});
      console.log(JSON.stringify({errors,connected,resolved,body:await good.text()}));
    `;
    const proc = Bun.spawn(["node", "--input-type=module", "-e", script], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toBe("");
    expect(await proc.exited).toBe(0);
    const data = JSON.parse(output);
    expect(data.errors).toHaveLength(3);
    expect(data.errors.every((message: string) => message.includes("private or reserved"))).toBe(true);
    expect(data.connected.map((c: { host: string }) => c.host)).toEqual([
      "93.184.216.34",
      "93.184.216.34",
      "93.184.216.34",
    ]);
    expect(data.connected[0].identity).toBe("public.example");
    expect(data.resolved).toEqual([
      "public.example",
      "public.example",
      "private.example",
      "mixed.example",
      "public.example",
    ]);
    expect(data.body).toBe("image bytes");
  });
});
