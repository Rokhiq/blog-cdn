// ==UserScript==
// @name         Post Archiver (X + Pixiv)
// @namespace    Archiver
// @version      0.2
// @description  Arsipin post X dan artwork Pixiv (gambar + caption) jadi satu file HTML
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://www.pixiv.net/*
// @grant        GM_xmlhttpRequest
// @connect      pbs.twimg.com
// @connect      i.pximg.net
// @connect      www.pixiv.net
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============ UTILITAS BERSAMA ============

  function fetchAsBase64(url, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: headers || {},
        responseType: 'blob',
        onload: (res) => {
          if (res.status >= 400) {
            reject(new Error(`HTTP ${res.status} untuk ${url}`));
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(res.response);
        },
        onerror: reject,
      });
    });
  }

  function fetchJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        onload: (res) => {
          try {
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject,
      });
    });
  }

  function buildHtml({ displayName, handle, caption, permalink, images, sourceLabel }) {
    const imageTags = images
      .map((src) => `<img src="${src}" style="max-width:100%;border-radius:8px;margin-bottom:12px;">`)
      .join('\n');

    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Arsip: ${displayName}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#171717; margin:0; padding:24px; display:flex; justify-content:center; }
  .card { background:#1e1e1e; border-radius:16px; padding:20px; max-width:520px; width:100%; box-shadow:0 1px 4px rgba(0,0,0,0.4); color:#e8e8e8; }
  .author { font-weight:600; color:#f2f2f2; }
  .handle { color:#999; font-size:14px; margin-bottom:12px; }
  .caption { white-space:pre-wrap; margin-bottom:16px; line-height:1.5; }
  .source { font-size:13px; color:#888; word-break:break-all; }
  a { color:#4db8ff; text-decoration:none; }
</style>
</head>
<body>
  <div class="card">
    <div class="author">${displayName}</div>
    <div class="handle">${handle}</div>
    ${imageTags}
    <div class="caption">${caption}</div>
    <div class="source">${sourceLabel}: <a href="${permalink}" target="_blank">${permalink}</a></div>
  </div>
</body>
</html>`;
  }

  function downloadHtml(filename, htmlContent) {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function sanitizeFilename(str) {
    return (str || 'post').replace(/[^a-z0-9_]/gi, '').slice(0, 40);
  }

  // ============ MODUL X ============

  const XArchiver = (function () {
    const PROCESSED_ATTR = 'data-archiver';
    const ICON_SVG = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M12 3v10.5m0 0l-3.5-3.5M12 13.5l3.5-3.5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
          stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

    function findActionBar(article) {
      const groups = article.querySelectorAll('div[role="group"]');
      return groups.length ? groups[groups.length - 1] : null;
    }

    function upgradeImageUrl(url) {
      try {
        const u = new URL(url);
        u.searchParams.set('name', 'orig');
        return u.toString();
      } catch (e) {
        return url;
      }
    }

    function getImages(article) {
      const imgs = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
      const urls = new Set();
      imgs.forEach((img) => urls.add(upgradeImageUrl(img.src)));
      return Array.from(urls);
    }

    function getCaption(article) {
      const el = article.querySelector('[data-testid="tweetText"]');
      return el ? el.innerText.trim() : '';
    }

    function getAuthorInfo(article) {
      const nameEl = article.querySelector('[data-testid="User-Name"]');
      let displayName = '';
      let handle = '';
      if (nameEl) {
        const spans = nameEl.querySelectorAll('span');
        spans.forEach((s) => {
          if (s.textContent.startsWith('@')) handle = s.textContent.trim();
        });
        displayName = nameEl.querySelector('span')?.textContent.trim() || '';
      }
      return { displayName, handle };
    }

    function getPermalink(article) {
      const timeEl = article.querySelector('time');
      const link = timeEl?.closest('a');
      if (link) return new URL(link.getAttribute('href'), location.origin).toString();
      return location.href;
    }

    async function handleClick(article, btn) {
      btn.style.opacity = '0.5';
      try {
        const images = getImages(article);
        const caption = getCaption(article);
        const { displayName, handle } = getAuthorInfo(article);
        const permalink = getPermalink(article);

        const base64Images = await Promise.all(images.map((u) => fetchAsBase64(u)));
        const html = buildHtml({
          displayName, handle, caption, permalink,
          images: base64Images, sourceLabel: 'Sumber',
        });

        const filename = `x_${sanitizeFilename(handle)}_${Date.now()}.html`;
        downloadHtml(filename, html);
      } catch (err) {
        console.error('[X Archiver] Gagal arsip:', err);
        alert('Gagal arsip post ini. Cek console buat detail.');
      } finally {
        btn.style.opacity = '1';
      }
    }

    function injectButton(article) {
      if (article.getAttribute(PROCESSED_ATTR)) return;
      const bar = findActionBar(article);
      if (!bar) return;

      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.cursor = 'pointer';
      wrapper.style.color = 'rgb(83, 100, 113)';
      wrapper.style.padding = '0 8px';
      wrapper.title = 'Arsipkan post ini';
      wrapper.innerHTML = ICON_SVG;

      wrapper.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleClick(article, wrapper);
      });
      wrapper.addEventListener('mouseenter', () => (wrapper.style.color = 'rgb(29, 155, 240)'));
      wrapper.addEventListener('mouseleave', () => (wrapper.style.color = 'rgb(83, 100, 113)'));

      bar.appendChild(wrapper);
      article.setAttribute(PROCESSED_ATTR, 'true');
    }

    function scan() {
      document.querySelectorAll('article[data-testid="tweet"]').forEach(injectButton);
    }

    function init() {
      const observer = new MutationObserver(() => scan());
      observer.observe(document.body, { childList: true, subtree: true });
      scan();
    }

    return { init };
  })();

  // ============ MODUL PIXIV ============

  const PixivArchiver = (function () {
    function getIllustId() {
      const m = location.pathname.match(/artworks\/(\d+)/);
      return m ? m[1] : null;
    }

    async function fetchIllustData(id) {
      const info = await fetchJson(`https://www.pixiv.net/ajax/illust/${id}`);
      const pages = await fetchJson(`https://www.pixiv.net/ajax/illust/${id}/pages`);
      return { info: info.body, pages: pages.body };
    }

    function stripHtml(str) {
      const div = document.createElement('div');
      div.innerHTML = str || '';
      return div.textContent.trim();
    }

    function createFloatingButton() {
      const btn = document.createElement('div');
      btn.textContent = '⬇ Arsip';
      btn.style.position = 'fixed';
      btn.style.bottom = '24px';
      btn.style.right = '24px';
      btn.style.zIndex = '99999';
      btn.style.background = '#0096fa';
      btn.style.color = '#fff';
      btn.style.padding = '10px 16px';
      btn.style.borderRadius = '999px';
      btn.style.fontSize = '14px';
      btn.style.fontWeight = '600';
      btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
      btn.style.cursor = 'pointer';
      btn.style.userSelect = 'none';
      document.body.appendChild(btn);
      return btn;
    }

    async function handleClick(btn) {
      const id = getIllustId();
      if (!id) {
        alert('Buka halaman artwork dulu (URL harus mengandung /artworks/{id}).');
        return;
      }

      const originalText = btn.textContent;
      btn.textContent = '...';
      try {
        const { info, pages } = await fetchIllustData(id);

        if (info.illustType === 2) {
          alert('Post ini ugoira (gambar bergerak). Belum didukung di versi ini, di-skip dulu.');
          return;
        }

        const imageUrls = pages.map((p) => p.urls.original);
        const headers = { Referer: 'https://www.pixiv.net/' };
        const base64Images = await Promise.all(imageUrls.map((u) => fetchAsBase64(u, headers)));

        const caption = stripHtml(info.description);
        const html = buildHtml({
          displayName: info.userName,
          handle: `pixiv.net/users/${info.userId}`,
          caption: `${info.title}\n\n${caption}`,
          permalink: location.href,
          images: base64Images,
          sourceLabel: 'Sumber',
        });

        const filename = `pixiv_${sanitizeFilename(info.userName)}_${id}.html`;
        downloadHtml(filename, html);
      } catch (err) {
        console.error('[Pixiv Archiver] Gagal arsip:', err);
        alert('Gagal arsip artwork ini. Cek console buat detail.');
      } finally {
        btn.textContent = originalText;
      }
    }

    function init() {
      if (!/artworks\/\d+/.test(location.pathname)) return;
      const btn = createFloatingButton();
      btn.addEventListener('click', () => handleClick(btn));
    }

    return { init };
  })();

  // ============ ROUTING ============

  const host = location.hostname;
  if (host === 'x.com' || host === 'twitter.com') {
    XArchiver.init();
  } else if (host === 'www.pixiv.net') {
    // Pixiv adalah SPA, URL bisa berubah tanpa reload halaman
    let lastPath = location.pathname;
    PixivArchiver.init();
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        document.querySelectorAll('div').forEach((el) => {
          if (el.textContent === '⬇ Arsip' || el.textContent === '...') el.remove();
        });
        PixivArchiver.init();
      }
    }, 1000);
  }
})();