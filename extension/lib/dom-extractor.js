(() => {
  const MAX_ELEMENTS = 150;
  const MAX_TEXT = 120;
  const SELECTORS = [
    'header', 'nav', 'main', 'footer', 'aside', 'article', 'section',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a[href]', 'button', 'input', 'select', 'textarea', 'form',
    'img[alt]', 'table', 'ul', 'ol', '[role]'
  ];

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  }

  function coarseRegion(rect, viewportWidth, viewportHeight) {
    const vertical = rect.top + rect.height / 2 < viewportHeight / 3
      ? 'top'
      : rect.top + rect.height / 2 < (viewportHeight * 2) / 3
        ? 'middle'
        : 'bottom';
    const horizontal = rect.left + rect.width / 2 < viewportWidth / 3
      ? 'left'
      : rect.left + rect.width / 2 < (viewportWidth * 2) / 3
        ? 'center'
        : 'right';
    return `${vertical}-${horizontal}`;
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getText(el) {
    if (el.matches('img[alt]')) return cleanText(el.getAttribute('alt'));
    return cleanText(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '');
  }

  function extractPageStructure() {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const seen = new Set();
    const elements = [];

    for (const selector of SELECTORS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch (_) {
        continue;
      }

      for (const el of nodes) {
        if (elements.length >= MAX_ELEMENTS) break;
        if (seen.has(el) || !isVisible(el)) continue;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        const role = el.getAttribute('role') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const text = getText(el);

        elements.push({
          tag: el.tagName.toLowerCase(),
          role,
          ariaLabel: cleanText(ariaLabel),
          text,
          rect: {
            x: Math.round(rect.left + window.scrollX),
            y: Math.round(rect.top + window.scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          region: coarseRegion(rect, viewportWidth, viewportHeight)
        });
      }
      if (elements.length >= MAX_ELEMENTS) break;
    }

    // Graceful fallback for very unusual pages without the semantic selectors above.
    if (elements.length === 0) {
      const fallback = document.querySelectorAll('h1,h2,h3,a[href],button');
      for (const el of fallback) {
        if (elements.length >= MAX_ELEMENTS || !isVisible(el)) break;
        const rect = el.getBoundingClientRect();
        elements.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          ariaLabel: cleanText(el.getAttribute('aria-label') || ''),
          text: getText(el),
          rect: {
            x: Math.round(rect.left + window.scrollX),
            y: Math.round(rect.top + window.scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          region: coarseRegion(rect, viewportWidth, viewportHeight)
        });
      }
    }

    return {
      url: location.href,
      title: document.title,
      viewport: { width: viewportWidth, height: viewportHeight },
      elementCount: elements.length,
      elements
    };
  }

  window.blvDomExtractor = { extractPageStructure };
})();
