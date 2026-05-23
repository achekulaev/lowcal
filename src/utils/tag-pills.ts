import type { CSSProperties } from "react";
import type { ResolvedTheme } from "../settings/global-settings";

/**
 * Brand / concept palette overrides — a curated list of common dev / infra
 * words whose colour is recognisable enough that hashing to a random hue would
 * lose meaning (e.g. `bash` should read as black, `aws` should read as
 * Amazon orange, `redis` should be red, `db` should be a neutral HDD grey).
 *
 * Lookup is case-insensitive AND hyphen/underscore/whitespace-insensitive —
 * so `back-end`, `Back End`, `BackEnd`, and `BACKEND` all match the same key.
 * `+` and `#` are preserved so language identifiers like `c++` and `c#` are
 * distinct from plain `c`.
 *
 * For purples: the random hash path intentionally avoids the 260°–330° band,
 * but iconic brand purples (Terraform, Vite, Bootstrap, PHP, …) are allowed
 * here because the brand association is the whole point of the override.
 */
type BrandStyle =
  | { readonly kind: "hue"; readonly h: number; readonly s?: number }
  | { readonly kind: "black" }
  | { readonly kind: "grey" }
  | { readonly kind: "white" };

const BLACK: BrandStyle = { kind: "black" };
const GREY: BrandStyle = { kind: "grey" };
function H(h: number, s = 30): BrandStyle {
  return { kind: "hue", h, s };
}

/** Normalise a tag for brand-palette lookup. Keeps `+` and `#` for language IDs. */
function normalizeBrandKey(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

const BRAND_PALETTE: Readonly<Record<string, BrandStyle>> = {
  // ── Languages, runtimes, shells ───────────────────────────────────────────
  assembly: BLACK,
  asm: BLACK,
  bash: BLACK,
  c: H(218, 28),
  "c#": H(248, 32),
  "c++": H(214, 30),
  clojure: H(100, 32),
  cobol: GREY,
  cpp: H(214, 30),
  crystal: H(220, 32),
  csharp: H(248, 32),
  d: H(358, 30),
  dart: H(200, 32),
  delphi: H(0, 30),
  dotnet: H(248, 30),
  elixir: H(260, 30),
  elm: H(195, 32),
  erlang: H(350, 30),
  "f#": H(230, 30),
  fish: H(18, 32),
  fortran: GREY,
  fsharp: H(230, 30),
  go: H(188, 34),
  golang: H(188, 34),
  groovy: H(100, 28),
  haskell: H(260, 28),
  html: H(15, 32),
  java: H(16, 32),
  javascript: H(50, 34),
  js: H(50, 34),
  julia: H(250, 30),
  jvm: H(16, 28),
  kotlin: H(24, 32),
  lisp: H(125, 30),
  lua: H(215, 30),
  net: H(248, 30),
  nim: H(48, 32),
  node: H(102, 32),
  nodejs: H(102, 32),
  objectivec: H(198, 30),
  ocaml: H(28, 32),
  pascal: H(28, 30),
  perl: H(215, 28),
  php: H(250, 30),
  powershell: H(215, 32),
  pwsh: H(215, 32),
  python: H(215, 34),
  py: H(215, 34),
  r: H(192, 32),
  racket: H(16, 30),
  ruby: H(354, 36),
  rust: H(16, 32),
  scala: H(0, 32),
  sh: GREY,
  shell: GREY,
  swift: H(22, 32),
  terminal: GREY,
  ts: H(213, 32),
  typescript: H(213, 32),
  v: H(218, 30),
  vb: H(215, 30),
  vbnet: H(215, 30),
  zig: H(36, 32),
  zsh: GREY,

  // ── Frontend frameworks & libs ────────────────────────────────────────────
  angular: H(350, 32),
  astro: H(18, 32),
  backbone: H(210, 28),
  bootstrap: H(268, 30),
  chakra: H(178, 30),
  ember: H(15, 30),
  gatsby: H(270, 30),
  jquery: H(210, 28),
  material: H(210, 30),
  materialui: H(210, 30),
  mui: H(210, 30),
  next: BLACK,
  nextjs: BLACK,
  nuxt: H(138, 30),
  preact: H(252, 30),
  react: H(192, 34),
  reactnative: H(192, 34),
  remix: H(215, 32),
  sass: H(335, 30),
  scss: H(335, 30),
  shadcn: BLACK,
  solid: H(215, 30),
  solidjs: H(215, 30),
  styledcomponents: H(335, 30),
  svelte: H(14, 32),
  sveltekit: H(14, 32),
  tailwind: H(188, 32),
  tailwindcss: H(188, 32),
  vue: H(138, 32),
  vuejs: H(138, 32),

  // ── Backend frameworks ────────────────────────────────────────────────────
  actix: H(16, 30),
  asp: H(248, 30),
  aspnet: H(248, 30),
  django: H(140, 28),
  echo: H(210, 28),
  express: GREY,
  expressjs: GREY,
  fastapi: H(168, 32),
  fastify: BLACK,
  fiber: H(210, 30),
  flask: BLACK,
  gin: H(170, 30),
  hapi: GREY,
  koa: GREY,
  laravel: H(0, 32),
  nestjs: H(350, 32),
  phoenix: H(14, 32),
  rails: H(354, 32),
  rocket: H(0, 32),
  ror: H(354, 32),
  rubyonrails: H(354, 32),
  spring: H(110, 32),
  springboot: H(110, 32),
  strapi: H(248, 30),
  symfony: GREY,

  // ── Databases ─────────────────────────────────────────────────────────────
  bigquery: H(215, 32),
  cassandra: H(210, 28),
  clickhouse: H(48, 32),
  cockroach: H(210, 30),
  cockroachdb: H(210, 30),
  couchbase: H(0, 30),
  couchdb: H(0, 28),
  database: GREY,
  databases: GREY,
  db: GREY,
  dbms: GREY,
  duckdb: H(46, 32),
  dynamo: H(215, 32),
  dynamodb: H(215, 32),
  elastic: H(170, 32),
  elasticsearch: H(170, 32),
  firebase: H(35, 34),
  firestore: H(35, 34),
  influxdb: H(218, 30),
  mariadb: H(195, 30),
  memcached: H(95, 28),
  mongo: H(100, 32),
  mongodb: H(100, 32),
  mssql: H(0, 30),
  mysql: H(28, 32),
  neo4j: H(200, 32),
  nosql: GREY,
  oracle: H(0, 32),
  oracledb: H(0, 32),
  planetscale: BLACK,
  postgres: H(210, 32),
  postgresql: H(210, 32),
  prisma: H(220, 30),
  psql: H(210, 32),
  redis: H(358, 36),
  rocksdb: GREY,
  snowflake: H(190, 34),
  sql: GREY,
  sqlite: H(210, 30),
  sqlserver: H(0, 30),
  supabase: H(140, 32),
  timescale: H(0, 28),
  timescaledb: H(0, 28),

  // ── Cloud providers ───────────────────────────────────────────────────────
  akamai: H(0, 30),
  alibaba: H(15, 32),
  amazon: H(32, 36),
  apple: GREY,
  aws: H(32, 36),
  azure: H(205, 32),
  cloud: GREY,
  cloudflare: H(25, 34),
  digitalocean: H(215, 32),
  ec2: H(32, 32),
  fastly: H(0, 32),
  fly: H(245, 28),
  flyio: H(245, 28),
  gcp: H(218, 34),
  google: H(218, 34),
  googlecloud: H(218, 34),
  heroku: H(248, 28),
  ibm: H(218, 30),
  ibmcloud: H(218, 30),
  lambda: H(32, 32),
  linode: H(95, 30),
  microsoft: H(205, 32),
  netlify: H(175, 32),
  ovh: H(215, 30),
  rds: H(215, 30),
  render: H(95, 30),
  s3: H(32, 32),
  vercel: BLACK,
  vultr: H(218, 30),

  // ── DevOps / orchestration / VCS / CI ─────────────────────────────────────
  ansible: H(0, 32),
  argo: H(35, 32),
  argocd: H(35, 32),
  bitbucket: H(215, 32),
  buildkite: H(95, 30),
  chef: H(15, 30),
  circleci: BLACK,
  consul: H(340, 30),
  docker: H(205, 34),
  envoy: H(250, 28),
  flux: H(218, 30),
  git: H(14, 34),
  github: BLACK,
  gitlab: H(15, 32),
  helm: H(215, 32),
  istio: H(195, 32),
  jenkins: H(215, 28),
  k3s: H(217, 28),
  k8s: H(217, 32),
  kong: H(0, 32),
  kubernetes: H(217, 32),
  linkerd: H(110, 32),
  nomad: H(110, 30),
  openshift: H(0, 34),
  packer: H(220, 28),
  podman: H(248, 28),
  portainer: H(195, 32),
  pulumi: H(245, 30),
  puppet: H(15, 30),
  rancher: H(190, 32),
  saltstack: H(95, 30),
  spinnaker: H(218, 30),
  tekton: H(218, 28),
  terraform: H(258, 30),
  vault: H(45, 34),

  // ── Networking / web servers ──────────────────────────────────────────────
  apache: H(0, 32),
  bind: H(210, 28),
  caddy: H(195, 30),
  dns: GREY,
  firewall: H(0, 32),
  haproxy: H(140, 30),
  iptables: GREY,
  ldap: GREY,
  nginx: H(125, 32),
  ntp: GREY,
  pfsense: H(0, 28),
  proxy: GREY,
  route53: H(248, 28),
  ssh: BLACK,
  ssl: H(45, 32),
  tls: H(45, 32),
  traefik: H(215, 30),
  vlan: GREY,
  vpc: GREY,
  vpn: GREY,
  waf: H(0, 30),
  wireguard: H(0, 32),

  // ── Monitoring / observability ────────────────────────────────────────────
  datadog: H(248, 28),
  elk: H(170, 30),
  fluentd: H(95, 30),
  grafana: H(25, 34),
  jaeger: H(190, 30),
  kibana: H(335, 30),
  logstash: H(95, 28),
  loki: H(45, 32),
  nagios: H(95, 30),
  newrelic: H(95, 32),
  opentelemetry: H(218, 30),
  opsgenie: H(210, 30),
  otel: H(218, 30),
  pagerduty: H(95, 32),
  prometheus: H(15, 32),
  sentry: H(335, 28),
  splunk: H(95, 30),
  statsd: GREY,
  tempo: H(45, 30),
  vector: H(210, 28),
  victoriametrics: H(0, 30),
  zabbix: H(0, 30),
  zipkin: H(218, 28),

  // ── Linux distros / OS ────────────────────────────────────────────────────
  alpine: H(210, 28),
  arch: H(195, 32),
  archlinux: H(195, 32),
  centos: H(248, 28),
  darwin: GREY,
  debian: H(340, 30),
  fedora: H(215, 32),
  freebsd: H(0, 30),
  ios: GREY,
  ipados: GREY,
  linux: BLACK,
  macos: GREY,
  manjaro: H(95, 32),
  opensuse: H(95, 30),
  osx: GREY,
  redhat: H(358, 36),
  rhel: H(358, 36),
  suse: H(95, 30),
  tux: BLACK,
  ubuntu: H(18, 32),
  unix: GREY,
  windows: H(205, 32),

  // ── Tooling: editors, package managers, build tools ───────────────────────
  babel: H(48, 32),
  cargo: H(16, 30),
  code: H(210, 30),
  composer: H(245, 28),
  cypress: H(170, 28),
  emacs: H(258, 28),
  eslint: H(248, 30),
  gradle: H(95, 30),
  intellij: H(335, 30),
  jest: H(0, 30),
  jetbrains: H(335, 28),
  maven: H(0, 30),
  mocha: H(15, 30),
  neovim: H(95, 32),
  npm: H(0, 32),
  nvim: H(95, 32),
  pip: H(215, 28),
  playwright: H(95, 30),
  pnpm: H(35, 32),
  prettier: H(18, 30),
  puppeteer: H(170, 28),
  pypi: H(215, 28),
  selenium: H(95, 28),
  sublime: H(35, 32),
  vim: H(95, 32),
  vite: H(270, 30),
  vscode: H(210, 30),
  webpack: H(198, 32),
  yarn: H(200, 32),

  // ── General dev concepts ──────────────────────────────────────────────────
  android: H(105, 32),
  api: H(218, 30),
  auth: H(45, 30),
  backend: H(15, 28),
  batch: H(45, 30),
  build: H(45, 30),
  cache: H(0, 28),
  cd: H(95, 30),
  ci: H(95, 30),
  cicd: H(95, 30),
  client: GREY,
  compute: GREY,
  cron: GREY,
  desktop: GREY,
  dev: H(95, 28),
  development: H(95, 28),
  deploy: H(35, 32),
  deployment: H(35, 32),
  e2e: H(245, 28),
  fe: H(210, 30),
  frontend: H(210, 32),
  fullstack: H(245, 30),
  iam: H(45, 30),
  infra: GREY,
  infrastructure: GREY,
  jwt: H(45, 32),
  job: H(45, 28),
  microservice: H(218, 30),
  microservices: H(218, 30),
  mobile: H(215, 30),
  monolith: GREY,
  network: GREY,
  oauth: H(218, 30),
  obsidian: H(280, 28),
  pipeline: H(215, 28),
  prod: H(0, 32),
  production: H(0, 32),
  qa: H(45, 32),
  queue: H(45, 28),
  release: H(95, 30),
  review: H(45, 30),
  saml: H(218, 30),
  security: H(0, 32),
  server: GREY,
  service: H(218, 28),
  sso: H(218, 30),
  staging: H(45, 30),
  storage: GREY,
  test: H(95, 28),
  testing: H(95, 28),
  ui: H(190, 30),
  ux: H(190, 30),
  web: H(210, 28),
  worker: H(45, 28),
};

/** FNV-1a 32-bit — stable, fast string fingerprint for palette derivation. */
function fnv1a32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Avalanche bits so nearby raw hashes become distant values (helps hue separation). */
function mix32(x: number): number {
  let z = x >>> 0;
  z ^= z >>> 16;
  z = Math.imul(z, 0x85ebca6b);
  z ^= z >>> 13;
  z = Math.imul(z, 0xc2b2ae35);
  z ^= z >>> 16;
  return z >>> 0;
}

/** Independent dimension seeds — avoids hue/sat/bg sliding together from one word of state. */
function tagWord(trimmedOrSentinel: string, salt: string): number {
  return mix32(fnv1a32(`${salt}\0${trimmedOrSentinel}`));
}

/**
 * Allowed hue bands (degrees). Purples / magentas (260–330) are intentionally
 * excluded; the blue band (200–260) is widened to absorb what would have been
 * purple pills. Total weight = 290°. A band that wraps past 360 (red/warm)
 * is normalised via `% 360` at the end.
 */
const HUE_BANDS: ReadonlyArray<readonly [number, number]> = [
  [350, 390], // red → warm (40°), wraps past 360°
  [30, 60], // orange (30°)
  [60, 95], // yellow / chartreuse (35°)
  [95, 160], // greens (65°)
  [160, 200], // teal / cyan (40°)
  [200, 260], // blues (60°) — widened to replace purples
  [330, 350], // pink / rose (20°)
];

const HUE_BAND_WIDTHS: ReadonlyArray<number> = HUE_BANDS.map(
  ([a, b]) => b - a,
);
const HUE_TOTAL_WIDTH: number = HUE_BAND_WIDTHS.reduce((s, w) => s + w, 0);

/** Map a 32-bit hash into one of the allowed hue bands, preserving spread. */
function hueFromBands(spread: number): number {
  let r = spread % HUE_TOTAL_WIDTH;
  for (let i = 0; i < HUE_BANDS.length; i++) {
    const w = HUE_BAND_WIDTHS[i];
    if (r < w) return (HUE_BANDS[i][0] + r) % 360;
    r -= w;
  }
  return 0;
}

/**
 * Per-theme lightness/saturation tuning. Hue logic, brand lookup, grey-or-not
 * branching are theme-independent — only the lightness ramps and a couple of
 * saturation caps flip between dark and light. Keeping them in one place
 * guarantees brand and hash pills stay visually consistent in either theme.
 */
type PillThemeRamp = {
  brandHueBgL: readonly [number, number];
  brandHueFgL: number;
  brandHueBorderShift: readonly [number, number];
  brandHueBorderClamp: number;
  brandBlack: {
    bgL: readonly [number, number];
    fgL: number;
    borderL: readonly [number, number];
  };
  brandGrey: {
    bgL: readonly [number, number];
    fgL: number;
    borderL: readonly [number, number];
  };
  brandWhite: {
    bgL: readonly [number, number];
    fgL: number;
    borderL: readonly [number, number];
  };
  hashBgBase: number;
  hashBgJitter: number;
  hashHighlightBgDelta: number;
  hashFgBase: number;
  hashFgJitter: number;
  hashBorderShift: readonly [number, number];
  hashBorderClamp: number;
  hashBorderDirection: "lighter" | "darker";
  hashColoredFgSatCap: number;
  hashGreyFgSatCap: number;
};

const DARK_RAMP: PillThemeRamp = {
  brandHueBgL: [25, 30],
  brandHueFgL: 78,
  brandHueBorderShift: [12, 18],
  brandHueBorderClamp: 44,
  brandBlack: { bgL: [10, 14], fgL: 76, borderL: [26, 36] },
  brandGrey: { bgL: [25, 30], fgL: 78, borderL: [37, 46] },
  brandWhite: { bgL: [82, 78], fgL: 16, borderL: [68, 60] },
  hashBgBase: 22,
  hashBgJitter: 9,
  hashHighlightBgDelta: 5,
  hashFgBase: 70,
  hashFgJitter: 14,
  hashBorderShift: [10, 18],
  hashBorderClamp: 44,
  hashBorderDirection: "lighter",
  hashColoredFgSatCap: 34,
  hashGreyFgSatCap: 10,
};

const LIGHT_RAMP: PillThemeRamp = {
  // Pastel chip on a near-white surface. Background sits high, text sits low,
  // border is a hair below bg so it reads as a hairline outline.
  brandHueBgL: [90, 86],
  brandHueFgL: 30,
  brandHueBorderShift: [-16, -22],
  brandHueBorderClamp: 60,
  // `BLACK` in light theme is intentionally still dark — a "terminal" badge
  // that pops against the light surface (mirrors how a dark Vercel/GitHub
  // wordmark sits on a white page).
  brandBlack: { bgL: [22, 18], fgL: 90, borderL: [38, 32] },
  brandGrey: { bgL: [90, 86], fgL: 28, borderL: [72, 66] },
  brandWhite: { bgL: [96, 93], fgL: 24, borderL: [78, 70] },
  hashBgBase: 85,
  hashBgJitter: 8,
  hashHighlightBgDelta: -4,
  hashFgBase: 26,
  hashFgJitter: 12,
  hashBorderShift: [-14, -22],
  hashBorderClamp: 60,
  hashBorderDirection: "darker",
  hashColoredFgSatCap: 46,
  hashGreyFgSatCap: 16,
};

function rampFor(theme: ResolvedTheme): PillThemeRamp {
  return theme === "light" ? LIGHT_RAMP : DARK_RAMP;
}

/** Materialise a curated `BrandStyle` into the same CSS shape used by the
 *  hash path. Lightness ranges come from the active `PillThemeRamp` so brand
 *  pills sit alongside generated pills in either theme. */
function brandPillStyle(
  style: BrandStyle,
  highlighted: boolean,
  ramp: PillThemeRamp,
): CSSProperties {
  switch (style.kind) {
    case "black": {
      const [bg, bgHi] = ramp.brandBlack.bgL;
      const [bd, bdHi] = ramp.brandBlack.borderL;
      const useBg = highlighted ? bgHi : bg;
      const useBd = highlighted ? bdHi : bd;
      return {
        background: `hsl(220 6% ${useBg}%)`,
        color: `hsl(220 6% ${ramp.brandBlack.fgL}%)`,
        border: `1px solid hsl(220 10% ${useBd}%)`,
      };
    }
    case "grey": {
      const [bg, bgHi] = ramp.brandGrey.bgL;
      const [bd, bdHi] = ramp.brandGrey.borderL;
      const useBg = highlighted ? bgHi : bg;
      const useBd = highlighted ? bdHi : bd;
      return {
        background: `hsl(220 5% ${useBg}%)`,
        color: `hsl(220 8% ${ramp.brandGrey.fgL}%)`,
        border: `1px solid hsl(220 8% ${useBd}%)`,
      };
    }
    case "white": {
      const [bg, bgHi] = ramp.brandWhite.bgL;
      const [bd, bdHi] = ramp.brandWhite.borderL;
      const useBg = highlighted ? bgHi : bg;
      const useBd = highlighted ? bdHi : bd;
      return {
        background: `hsl(220 8% ${useBg}%)`,
        color: `hsl(220 14% ${ramp.brandWhite.fgL}%)`,
        border: `1px solid hsl(220 10% ${useBd}%)`,
      };
    }
    case "hue": {
      const h = style.h;
      const s = style.s ?? 30;
      const [bgL, bgLHi] = ramp.brandHueBgL;
      const useBgL = highlighted ? bgLHi : bgL;
      const fgSat = Math.min(s + 6, 38);
      const borderSat = highlighted
        ? Math.min(s + 4, 38)
        : Math.max(s - 8, 10);
      const [shiftBase, shiftHi] = ramp.brandHueBorderShift;
      const useShift = highlighted ? shiftHi : shiftBase;
      const rawBorderL = useBgL + useShift;
      const borderL =
        ramp.hashBorderDirection === "lighter"
          ? Math.min(rawBorderL, ramp.brandHueBorderClamp)
          : Math.max(rawBorderL, ramp.brandHueBorderClamp);
      return {
        background: `hsl(${h} ${s}% ${useBgL}%)`,
        color: `hsl(${h} ${fgSat}% ${ramp.brandHueFgL}%)`,
        border: `1px solid hsl(${h} ${borderSat}% ${borderL}%)`,
      };
    }
  }
}

/**
 * Pill colours derived from the tag string (same name → same colors).
 *
 * Resolution order:
 *  1. Curated `BRAND_PALETTE` override — case- and hyphen-insensitive lookup
 *     so well-known dev/infra words render with recognisable brand colours
 *     (Bash → black, AWS → Amazon orange, Python → Python blue, …).
 *  2. Otherwise: hash-based muted-pastel derivation, tuned for the active
 *     `theme`. Hues are drawn from a curated set of bands that skips purples
 *     (mass shifted into a widened blue band); ~1 in 5 tags renders as a
 *     near-neutral grey to break up the coloured row.
 *
 * `theme` is optional and defaults to `"dark"` so legacy / preview call sites
 * keep working unchanged. Production callers in React pass the live value
 * from `useAppearance` so pills re-render when the user flips appearance.
 */
export function tagPillStyle(
  tag: string,
  highlighted: boolean,
  theme: ResolvedTheme = "dark",
): CSSProperties {
  const key = tag.trim();
  const k = key.length === 0 ? "\0" : key;
  const ramp = rampFor(theme);

  const brand = BRAND_PALETTE[normalizeBrandKey(k)];
  if (brand) return brandPillStyle(brand, highlighted, ramp);

  // `u % N` on a single FNV word often clusters similar tags; multiply-spread fixes that.
  const hueSeed = tagWord(k, "hue");
  const hueSpread = Math.imul(hueSeed, 2654435761) >>> 0;
  const hue = hueFromBands(hueSpread);
  // ~1 in 5 tags use a neutral grey palette — derived from a separate hash word
  // so the choice is deterministic per tag and independent of hue selection.
  const isGrey = tagWord(k, "grey") % 5 === 0;
  const sat = isGrey
    ? 3 + (tagWord(k, "sat") % 6) // 3–8%, near-neutral
    : 16 + (tagWord(k, "sat") % 17); // 16–32%, paler chroma
  const bgBase = ramp.hashBgBase + (tagWord(k, "bg") % ramp.hashBgJitter);
  const fg = ramp.hashFgBase + (tagWord(k, "fg") % ramp.hashFgJitter);
  const bg = highlighted ? bgBase + ramp.hashHighlightBgDelta : bgBase;
  const borderSat = Math.max(sat - 10, isGrey ? 0 : 9);
  const [borderShiftBase, borderShiftHi] = ramp.hashBorderShift;
  const useBorderShift = highlighted ? borderShiftHi : borderShiftBase;
  const rawBorderL = bg + useBorderShift;
  const fgSat = isGrey
    ? Math.min(sat + 2, ramp.hashGreyFgSatCap)
    : Math.min(sat + 5, ramp.hashColoredFgSatCap);
  const highlightBorderSat = highlighted
    ? Math.min(sat + 8, isGrey ? 14 : 36)
    : borderSat;
  const borderL =
    ramp.hashBorderDirection === "lighter"
      ? Math.min(rawBorderL, ramp.hashBorderClamp)
      : Math.max(rawBorderL, ramp.hashBorderClamp);
  return {
    background: `hsl(${hue} ${sat}% ${bg}%)`,
    color: `hsl(${hue} ${fgSat}% ${fg}%)`,
    border: `1px solid hsl(${hue} ${highlightBorderSat}% ${borderL}%)`,
  };
}
