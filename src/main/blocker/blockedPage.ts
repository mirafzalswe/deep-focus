// Страница, которую заглушка отдаёт на HTTP-запрос к заблокированному сайту. Без адреса сайта:
// URL посещений нигде не повторяется и не сохраняется.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function blockedPageHtml(texts: { lang: string; title: string; body: string }): string {
  const title = escapeHtml(texts.title);
  const body = escapeHtml(texts.body);
  return `<!doctype html>
<html lang="${escapeHtml(texts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 "Segoe UI", system-ui, sans-serif;
    background: #f4f5f7; color: #1f2328; }
  @media (prefers-color-scheme: dark) { body { background: #111418; color: #e6e8eb; } p { color: #9aa3ad; } }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 .75rem; }
  p { margin: 0; color: #59636e; }
</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>
`;
}
