import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const PINAR_DIR = join(DIR, "..", "deploy", "k8s", "pinar");

function docs(name: string): Record<string, any>[] {
  const parsed = Bun.YAML.parse(readFileSync(join(PINAR_DIR, name), "utf8"));
  return Array.isArray(parsed) ? parsed : [parsed];
}

const EXPECTED_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const hostMatches = (match: string): string[] => [...match.matchAll(/Host\(`([^`]+)`\)/g)].map((m) => m[1]);

describe("deploy/k8s/pinar", () => {
  test("kustomization targets the edger namespace and lists exactly the 3 files", () => {
    const [kustomization] = docs("kustomization.yaml");
    expect(kustomization.apiVersion).toBe("kustomize.config.k8s.io/v1beta1");
    expect(kustomization.kind).toBe("Kustomization");
    expect(kustomization.namespace).toBe("edger");
    expect(kustomization.resources).toHaveLength(3);
    expect([...kustomization.resources].sort()).toEqual(
      ["certificates.yaml", "cloudflare-only.yaml", "ingressroutes.yaml"].sort(),
    );
  });

  test("certificates are issued by the cluster DNS-01 issuer with the exact names", () => {
    const certificates = docs("certificates.yaml");
    expect(certificates).toHaveLength(1);
    for (const certificate of certificates) {
      expect(certificate.apiVersion).toBe("cert-manager.io/v1");
      expect(certificate.kind).toBe("Certificate");
      expect(certificate.spec.issuerRef).toEqual({ kind: "ClusterIssuer", name: "letsencrypt-dns" });
      expect(certificate.spec.secretName).toBe(certificate.metadata.name);
    }
    const byName = Object.fromEntries(certificates.map((c) => [c.metadata.name, c]));
    expect(byName["pinar-tls"].spec.dnsNames).toEqual(["pinar.dev", "www.pinar.dev"]);
  });

  test("the cloudflare-only middleware allowlists exactly the published ranges and sets no ipStrategy", () => {
    const [middleware] = docs("cloudflare-only.yaml");
    expect(middleware.apiVersion).toBe("traefik.io/v1alpha1");
    expect(middleware.kind).toBe("Middleware");
    expect(middleware.metadata.name).toBe("cloudflare-only");
    expect(middleware.spec.ipAllowList.sourceRange).toEqual(EXPECTED_RANGES);
    expect(middleware.spec.ipStrategy).toBeUndefined();
  });

  test("each ingress route points at edger:3000 through the cloudflare-only middleware", () => {
    const routes = docs("ingressroutes.yaml");
    expect(routes).toHaveLength(1);
    for (const route of routes) {
      expect(route.apiVersion).toBe("traefik.io/v1alpha1");
      expect(route.kind).toBe("IngressRoute");
      expect(route.spec.entryPoints).toEqual(["websecure"]);
      const rule = route.spec.routes[0];
      expect(rule.kind).toBe("Rule");
      const middlewares = [
        ...(rule.middlewares ?? route.spec.middlewares ?? []),
      ];
      expect(middlewares).toEqual([{ name: "cloudflare-only" }]);
      const services = rule.services ?? route.spec.services ?? [];
      expect(services).toHaveLength(1);
      expect(services[0].name).toBe("edger");
      expect(services[0].port).toBe(3000);
      expect(services[0].passHostHeader).not.toBe(false);
    }
  });

  test("each ingress route has the exact match and the certificate of its hosts", () => {
    const routes = docs("ingressroutes.yaml");
    const certificates = docs("certificates.yaml");
    const certBySecret = Object.fromEntries(certificates.map((c) => [c.spec.secretName, c]));
    const expected: Record<string, { match: string; secretName: string }> = {
      pinar: { match: "Host(`pinar.dev`) || Host(`www.pinar.dev`)", secretName: "pinar-tls" },
    };
    for (const route of routes) {
      const name = route.metadata.name;
      expect(expected[name]).toBeDefined();
      expect(route.spec.routes[0].match).toBe(expected[name].match);
      expect(route.spec.tls.secretName).toBe(expected[name].secretName);
      // The certificate referenced by the route covers exactly the routed hosts.
      const hosts = hostMatches(route.spec.routes[0].match);
      expect([...certBySecret[expected[name].secretName].spec.dnsNames].sort()).toEqual([...hosts].sort());
    }
  });

  test("the certificate dnsNames cover exactly the routed hosts (nothing extra, nothing missing)", () => {
    const routes = docs("ingressroutes.yaml");
    const certificates = docs("certificates.yaml");
    const routedHosts = new Set(routes.flatMap((route) => hostMatches(route.spec.routes[0].match)));
    const dnsNames = new Set(certificates.flatMap((c) => c.spec.dnsNames));
    expect([...routedHosts].sort()).toEqual([...dnsNames].sort());
  });
});
