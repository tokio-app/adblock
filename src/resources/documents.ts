// The HTML and XML resources.

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** A VAST response with no ads, which players read as "nothing to play". */
export const vast = (version: "2.0" | "3.0" | "4.0"): string =>
  version === "4.0"
    ? `${XML}<VAST version="4.0" xmlns="http://www.iab.com/VAST"/>\n`
    : `${XML}<VAST version="${version}"/>\n`;

/** A VMAP 1.0 playlist with no ad breaks. */
export const VMAP = `${XML}<vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0"/>\n`;

export const NOOP_HTML =
  "<!doctype html><html><head></head><body></body></html>\n";

/**
 * What a blocked frame shows instead: its original address, a link that
 * opens it in a new tab, and a click anywhere else loads it in the frame.
 * The address comes in the query, `click2load.html?url=<encodeURIComponent
 * (original)>`; anything but an http(s) address shows nothing to load.
 */
export const CLICK2LOAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blocked frame</title>
<style>
html, body { height: 100%; margin: 0; }
body { display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 8px;
  font: 13px/1.4 system-ui, sans-serif; color: #333; background: #f2f2f2; cursor: pointer; }
main { max-width: 100%; text-align: center; }
p { margin: 0 0 6px; }
code { display: block; overflow-wrap: anywhere; user-select: all; cursor: text; color: #555; }
a { color: inherit; }
</style>
</head>
<body>
<main>
<p>This frame was blocked. Click to load it.</p>
<code id="url"></code>
<p><a id="open" target="_blank" rel="noopener noreferrer">Open in a new tab</a></p>
</main>
<script>
(function () {
  var url = new URLSearchParams(location.search).get("url") || "";
  if (!/^https?:\\/\\//i.test(url)) {
    document.querySelector("main").textContent = "This frame was blocked.";
    document.body.style.cursor = "default";
    return;
  }
  document.getElementById("url").textContent = url;
  document.getElementById("open").href = url;
  document.body.addEventListener("click", function (event) {
    if (event.target.closest("a, code")) return;
    location.replace(url);
  });
})();
</script>
</body>
</html>
`;
