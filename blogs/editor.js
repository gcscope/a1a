// Blog editor + publisher for a1a.ca.
//
// Firebase Auth is used ONLY to detect the admin (same account as the comment
// wall) — content never touches Firebase. Publishing commits files straight to
// the gcscope/a1a repo through the GitHub Contents API using a fine-grained PAT
// the admin pastes in once (stored in this browser's localStorage).
//
// NOTE: hiding the editor behind the UID check is cosmetic — anyone can open
// this page from view-source. The real security boundary is GitHub itself:
// nothing can be published without the PAT, which only exists in the owner's
// browser.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { firebaseConfig, ADMIN_UID } from "../firebase-config.js";

const REPO = "gcscope/a1a";
const API = "https://api.github.com";
const PAT_KEY = "a1a_gh_pat";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
await setPersistence(auth, browserLocalPersistence);

const statusEl = document.getElementById("editor-status");
const wrapEl = document.getElementById("editor-wrap");
const titleEl = document.getElementById("editor-title");
const bodyEl = document.getElementById("editor-body");
const logEl = document.getElementById("publish-log");
const publishBtn = document.getElementById("ed-publish");

// ---------- admin gate ----------

let gateResolved = false;
onAuthStateChanged(auth, (user) => {
  if (gateResolved) return;
  gateResolved = true;
  if (user && user.uid === ADMIN_UID) {
    statusEl.style.display = "none";
    wrapEl.style.display = "block";
  } else {
    location.href = "../blog.html";
  }
});

// ---------- toolbar ----------
// execCommand is deprecated but still supported everywhere and is by far the
// least code for a no-build vanilla site. If it ever breaks, this file is the
// only thing to replace.

document.querySelectorAll("#editor-toolbar .ed-btn[data-block]").forEach((b) => {
  b.addEventListener("click", () => {
    bodyEl.focus();
    document.execCommand("formatBlock", false, b.dataset.block);
  });
});

document.querySelectorAll("#editor-toolbar .ed-btn[data-cmd]").forEach((b) => {
  b.addEventListener("click", () => {
    bodyEl.focus();
    document.execCommand(b.dataset.cmd, false, null);
  });
});

// Font size: execCommand('fontSize') only speaks the legacy 1-7 scale and emits
// <font> tags. Mark the selection with size 7, then swap each <font size="7">
// for a span with the real pt size so output matches the site's inline-style
// convention (e.g. blog7's font-size: 10pt).
const fontSel = document.getElementById("editor-fontsize");
fontSel.addEventListener("change", () => {
  const pt = fontSel.value;
  fontSel.value = "";
  if (!pt) return;
  bodyEl.focus();
  document.execCommand("fontSize", false, "7");
  bodyEl.querySelectorAll('font[size="7"]').forEach((f) => {
    const span = document.createElement("span");
    span.style.fontSize = pt + "pt";
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  });
});

// ---------- images ----------
// Inserted as a live data-URL preview; the actual file is committed to
// images/ at publish time, once the post number (and thus filename) is known.

const pendingImages = []; // { id, ext, mimeType, base64 (no data: prefix), alt }
const imageBtn = document.getElementById("ed-image");
const imageInput = document.getElementById("ed-image-file");

imageBtn.addEventListener("click", () => imageInput.click());

imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  imageInput.value = "";
  if (!file) return;
  const alt = window.prompt("Image description (alt text):", "") || "";
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const id = "img" + Date.now();
    const ext = (file.name.match(/\.(\w+)$/) || [, "png"])[1].toLowerCase();
    pendingImages.push({
      id, ext,
      mimeType: file.type,
      base64: dataUrl.split(",", 2)[1],
      alt
    });
    bodyEl.focus();
    document.execCommand(
      "insertHTML", false,
      `<img data-upload-id="${id}" src="${dataUrl}" alt="${escapeHtml(alt)}">`
    );
  };
  reader.readAsDataURL(file);
});

// ---------- serialization ----------

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// innerHTML + hygiene pass (strip scripts / on* handlers), then swap image
// previews for the site's existing pattern: image wrapped in a link to the
// full-size file, bordered, living in ../images/.
function serializeContent(postNumber) {
  const clone = bodyEl.cloneNode(true);
  clone.querySelectorAll("script").forEach((s) => s.remove());
  clone.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((a) => {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    });
  });

  const usedImages = [];
  clone.querySelectorAll("img[data-upload-id]").forEach((img) => {
    const entry = pendingImages.find((p) => p.id === img.dataset.uploadId);
    if (!entry) { img.remove(); return; }
    const filename = `blog${postNumber}img${usedImages.length + 1}.${entry.ext}`;
    usedImages.push({ ...entry, filename });
    const a = document.createElement("a");
    a.href = `../images/${filename}`;
    a.innerHTML = `<img style="border: solid 2px black; max-width: 100%; height: auto;" src="../images/${filename}" alt="${escapeHtml(entry.alt)}">`;
    img.replaceWith(a);
  });

  return { contentHtml: clone.innerHTML.trim(), usedImages };
}

// Plain-text snippet for metas + the homepage "latest" teaser.
function textSnippet(maxLen) {
  const text = bodyEl.textContent.replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "");
}

// ---------- GitHub API ----------

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function b64DecodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function ghHeaders(pat) {
  return {
    "Authorization": `Bearer ${pat}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function ghGet(pat, path) {
  const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, { headers: ghHeaders(pat) });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function ghPut(pat, path, { base64Content, message, sha }) {
  const body = { message, content: base64Content };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(pat), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// PUT for files that should be new — if a previous publish attempt already
// created the file, fetch its sha and overwrite so retries don't 422.
async function ghPutNewFile(pat, path, base64Content, message) {
  try {
    return await ghPut(pat, path, { base64Content, message });
  } catch (e) {
    if (!/422/.test(e.message)) throw e;
    const existing = await ghGet(pat, path);
    return ghPut(pat, path, { base64Content, message, sha: existing.sha });
  }
}

// ---------- publish ----------

function log(msg) {
  logEl.textContent += msg + "\n";
}

function getPat() {
  let pat = localStorage.getItem(PAT_KEY);
  if (!pat) {
    pat = window.prompt(
      "Paste your GitHub personal access token (fine-grained, repo gcscope/a1a, Contents read/write).\nIt will be stored in this browser's localStorage."
    );
    if (pat) localStorage.setItem(PAT_KEY, pat.trim());
  }
  return pat ? pat.trim() : null;
}

publishBtn.addEventListener("click", async () => {
  logEl.textContent = "";

  const user = auth.currentUser;
  if (!user || user.uid !== ADMIN_UID) {
    log("Not signed in as admin — publish aborted.");
    return;
  }

  const title = titleEl.value.trim();
  if (!title) { log("Give the post a title first."); return; }
  if (!bodyEl.textContent.trim() && !bodyEl.querySelector("img")) {
    log("The post is empty."); return;
  }

  const pat = getPat();
  if (!pat) { log("No GitHub token — publish aborted."); return; }

  publishBtn.disabled = true;
  try {
    log("Finding next blog number…");
    const dir = await ghGet(pat, "blogs");
    const numbers = dir
      .map((f) => (f.name.match(/^blog(\d+)\.html$/) || [])[1])
      .filter(Boolean)
      .map(Number);
    // If a previous attempt already created the newest post file but failed
    // partway, reuse that number instead of skipping past it.
    const maxN = Math.max(...numbers);
    const listed = b64DecodeUtf8((await ghGet(pat, "blog.html")).content).includes(`blogs/blog${maxN}.html`);
    const n = listed ? maxN + 1 : maxN;
    log(`This will be blog ${n}.`);

    const { contentHtml, usedImages } = serializeContent(n);

    const now = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    const postDate = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${now.getFullYear()}`; // MM/DD/YYYY, like blog7
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const teaserDate = `${months[now.getMonth()]}/${pad(now.getDate())}/${now.getFullYear()}`; // Jul/26/2026, like index.html

    const metaSnippet = escapeHtml(textSnippet(150));

    log("Building post from blogtemplate.html…");
    const template = await (await fetch("blogtemplate.html")).text();
    const postHtml = template
      .replace(/<title>.*<\/title>/, `<title>${escapeHtml(title)} - a1a.ca</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1a1a.ca - ${metaSnippet}$2`)
      .replace(/blog1\.html/g, `blog${n}.html`)
      .replace(/(property="og:title" content=")[^"]*(")/, `$1${escapeHtml(title)} - a1a.ca$2`)
      .replace(/(name="twitter:title" content=")[^"]*(")/, `$1${escapeHtml(title)} - a1a.ca$2`)
      .replace(/(property="og:description" content=")[^"]*(")/, `$1${metaSnippet}$2`)
      .replace(/(name="twitter:description" content=")[^"]*(")/, `$1${metaSnippet}$2`)
      .replace(/>#<\/span>/, `>${n}</span>`)
      .replace(/<h1 style="margin-top: 5px;">.*<\/h1>/, `<h1 style="margin-top: 5px;">${escapeHtml(title)}</h1>`)
      .replace(/<p><b>Date<\/b><\/p>/, `<p><b>${postDate}</b></p>`)
      .replace(/<!--Put stuff here-->/, contentHtml);

    for (const img of usedImages) {
      log(`Uploading images/${img.filename}…`);
      await ghPutNewFile(pat, `images/${img.filename}`, img.base64, `Add image ${img.filename} for blog ${n}`);
    }

    log(`Creating blogs/blog${n}.html…`);
    await ghPutNewFile(pat, `blogs/blog${n}.html`, b64EncodeUtf8(postHtml), `Add blog ${n}: ${title}`);

    log("Adding post to the blog list…");
    const blogFile = await ghGet(pat, "blog.html");
    const entry = `<p><a class="i" href="blogs/blog${n}.html"><b>${escapeHtml(title)}</b></a></p>\n`;
    const blogHtml = b64DecodeUtf8(blogFile.content).replace(/<!--BLOGLIST END-->/, entry + "<!--BLOGLIST END-->");
    await ghPut(pat, "blog.html", {
      base64Content: b64EncodeUtf8(blogHtml),
      message: `Update blog list with blog ${n}`,
      sha: blogFile.sha
    });

    log("Updating sitemap.xml…");
    const sitemapFile = await ghGet(pat, "sitemap.xml");
    const sitemapUrl = `https://a1a.ca/blogs/blog${n}.html`;
    let sitemapXml = b64DecodeUtf8(sitemapFile.content);
    if (!sitemapXml.includes(sitemapUrl)) {
      sitemapXml = sitemapXml.replace(/<\/urlset>/, `  <url><loc>${sitemapUrl}</loc></url>\n</urlset>`);
      await ghPut(pat, "sitemap.xml", {
        base64Content: b64EncodeUtf8(sitemapXml),
        message: `Add blog ${n} to sitemap`,
        sha: sitemapFile.sha
      });
    }

    log("Updating the homepage's latest-blog teaser…");
    const indexFile = await ghGet(pat, "index.html");
    const teaser = `<!--LATEST START-->
<h1><a href="blogs/blog${n}.html">${escapeHtml(title)}</a></h1>
<p><b>${teaserDate}</b></p>
<div class="text-sample">
<p>
${metaSnippet}<span style="color: lightgrey;">...</span> <a style="font-size: 10pt; text-decoration: none;" href="blogs/blog${n}.html"><b>(read more)</b></a>
</p>
</div>
<!--LATEST END-->`;
    const indexHtml = b64DecodeUtf8(indexFile.content).replace(
      /<!--LATEST START-->[\s\S]*<!--LATEST END-->/,
      teaser
    );
    await ghPut(pat, "index.html", {
      base64Content: b64EncodeUtf8(indexHtml),
      message: `Update latest blog teaser to blog ${n}`,
      sha: indexFile.sha
    });

    log(`\nPublished! blog ${n} will be live at https://a1a.ca/blogs/blog${n}.html in about a minute.`);
  } catch (err) {
    console.error(err);
    log(`\nFAILED: ${err.message}`);
    log("Steps already completed were committed; nothing links to a missing page, so it's safe. Fix the issue and publish again, or clean up with git.");
    if (/401|403/.test(err.message)) {
      log("(If the token is bad/expired: it's stored as 'a1a_gh_pat' in localStorage — clear it and publish again to re-enter.)");
    }
  } finally {
    publishBtn.disabled = false;
  }
});
