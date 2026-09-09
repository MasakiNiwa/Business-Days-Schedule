/**
 * Service Worker の登録と更新の案内（docs/SPEC.md §13）。
 *
 * 静的サイトを一度キャッシュすると、古い版を掴んだまま気づけないのが一番の危険。
 * 新しい版を検知したら、勝手に切り替えず**利用者に知らせて選ばせる**。
 * 編集途中のフォームを黙って作り直してしまわないためでもある。
 *
 * ただし「新しい Service Worker が控えている」は「画面が古い」とは限らない。
 * 画面遷移はネットワーク優先で、資産名には内容のハッシュが入っているため、
 * オンラインで開いた時点の画面は既に最新版になっている。そこで案内を出すと、
 * 最新版を見ているのに更新を促され、押しても何も変わらない。
 * 実際にその状態になっていた。
 *
 * そこで、控えている版が持つ資産一覧と、いま画面が読み込んでいる資産を
 * 突き合わせる。すべて含まれていれば画面は既に最新なので、案内は出さずに
 * 黙って切り替える（オフライン用のキャッシュだけ新しくする）。
 */

const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

/** 資産一覧の問い合わせに答えが返らないときに諦めるまで。 */
const MANIFEST_TIMEOUT_MS = 3_000;

export type UpdatePrompt = {
  /** 待機中の新しい版へ切り替えて再読み込みする。 */
  apply: () => void;
};

export type ServiceWorkerHandlers = {
  onUpdateAvailable: (prompt: UpdatePrompt) => void;
};

/** いま画面が読み込んでいる資産の絶対パス。資産名には内容のハッシュが入っている。 */
export function currentAssetPaths(doc: Document = document): string[] {
  const nodes = doc.querySelectorAll<HTMLElement>('script[src], link[rel="stylesheet"][href]');
  const paths: string[] = [];
  for (const node of nodes) {
    const raw = node.getAttribute('src') ?? node.getAttribute('href');
    if (raw === null) continue;
    try {
      const url = new URL(raw, doc.baseURI);
      if (url.origin === globalThis.location.origin) paths.push(url.pathname);
    } catch {
      // 解釈できない参照は判断材料にしない。
    }
  }
  return paths;
}

/**
 * いま画面に出ている版が、控えている版と同じか。
 *
 * 画面が読み込んでいる資産がすべて新しい版の一覧に入っていれば、同じ版である。
 * 資産名にハッシュが入っているので、1つでも違えば別の版になる。
 * 判断材料が無いとき（資産を1つも拾えないとき）は「同じとは言えない」とする。
 * 黙って切り替えるより、案内を出すほうが害が小さい。
 */
export function isSameBuild(currentPaths: readonly string[], manifest: readonly string[]): boolean {
  if (currentPaths.length === 0) return false;
  const known = new Set(manifest.map((entry) => {
    try {
      return new URL(entry, globalThis.location.origin).pathname;
    } catch {
      return entry;
    }
  }));
  return currentPaths.every((path) => known.has(path));
}

/** 控えている版に資産一覧を尋ねる。答えが無ければ null。 */
async function askManifest(worker: ServiceWorker): Promise<string[] | null> {
  if (typeof MessageChannel === 'undefined') return null;
  return new Promise<string[] | null>((resolve) => {
    const channel = new MessageChannel();
    const timer = globalThis.setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, MANIFEST_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      globalThis.clearTimeout(timer);
      channel.port1.close();
      resolve(Array.isArray(event.data) ? (event.data as string[]) : null);
    };
    try {
      worker.postMessage('PRECACHE_MANIFEST', [channel.port2]);
    } catch {
      globalThis.clearTimeout(timer);
      resolve(null);
    }
  });
}

export function registerServiceWorker(handlers: ServiceWorkerHandlers): void {
  if (!('serviceWorker' in navigator)) return;

  // 利用者が「再読み込み」を選んだかどうか。
  // 初回登録でも clients.claim() で controllerchange が飛ぶため、
  // これを見ずに再読み込みすると、初めて開いた人が必ず1回リロードされてしまう。
  let updateAccepted = false;

  void navigator.serviceWorker
    .register(SW_URL)
    .then((registration) => {
      const consider = (worker: ServiceWorker): void => {
        void (async () => {
          const manifest = await askManifest(worker);
          if (manifest !== null && isSameBuild(currentAssetPaths(), manifest)) {
            // 画面は既に最新。案内は出さず、オフライン用のキャッシュだけ入れ替える。
            // updateAccepted は立てないので読み込み直しも起きない。
            worker.postMessage('SKIP_WAITING');
            return;
          }
          handlers.onUpdateAvailable({
            apply: () => {
              updateAccepted = true;
              worker.postMessage('SKIP_WAITING');
            },
          });
        })();
      };

      // 既に新しい版が控えている（前回の訪問で降ってきた）。
      if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
        consider(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (installing === null) return;
        installing.addEventListener('statechange', () => {
          // controller があるということは初回インストールではなく更新。
          if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
            consider(installing);
          }
        });
      });
    })
    .catch(() => {
      // 登録できなくてもアプリは通常どおり動く。オフライン対応が付かないだけ。
    });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 初回登録では読み込み直さない。編集中の入力を巻き込まないため。
    if (!updateAccepted || reloading) return;
    reloading = true;
    globalThis.location.reload();
  });
}
