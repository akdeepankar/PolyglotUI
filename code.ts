figma.showUI(__html__, { width: 400, height: 600, themeColors: true });

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '.')
    .replace(/^-+|-+$/g, '')
    .split('.')
    .slice(0, 3)
    .join('.');
}

function getContext(node: SceneNode): string {
  let parent = node.parent;
  while (parent && parent.type !== 'FRAME' && parent.type !== 'COMPONENT' && parent.type !== 'INSTANCE') {
    parent = parent.parent;
  }

  const parentName = parent ? parent.name.toLowerCase() : 'global';

  if (parentName.includes('button')) return 'button';
  if (parentName.includes('header') || parentName.includes('title')) return 'heading';
  if (parentName.includes('label')) return 'label';
  if (parentName.includes('input') || parentName.includes('text field')) return 'input';
  if (parentName.includes('helper') || parentName.includes('hint')) return 'helper';

  return 'text';
}

function getScreenName(node: SceneNode): string {
  let parent = node.parent;
  let lastFrame = 'general';

  while (parent && parent.type !== 'PAGE') {
    if (parent.type === 'FRAME' || parent.type === 'COMPONENT' || parent.type === 'INSTANCE') {
      lastFrame = parent.name;
    }
    parent = parent.parent;
  }

  return lastFrame.toLowerCase().replace(/\s+/g, '.');
}

async function scanSelection() {
  const textNodes: TextNode[] = [];

  function traverse(node: SceneNode) {
    if (!node.visible) return;
    if (node.type === 'TEXT') {
      textNodes.push(node);
    } else if ('children' in node) {
      for (const child of node.children) {
        traverse(child as SceneNode);
      }
    }
  }

  const selection = figma.currentPage.selection;
  if (selection.length > 0) {
    selection.forEach(traverse);
  } else {
    figma.currentPage.children.forEach(traverse);
  }

  console.log(`Found ${textNodes.length} text nodes`);

  // Optimized Font Loading: Collect all unique fonts first
  const uniqueFonts = new Map<string, FontName>();
  textNodes.forEach(node => {
    const font = node.fontName as FontName;
    uniqueFonts.set(`${font.family}_${font.style}`, font);
  });

  await Promise.all(
    Array.from(uniqueFonts.values()).map(font => figma.loadFontAsync(font).catch(() => { }))
  );

  const results = [];
  for (const node of textNodes) {
    const originalText = node.characters;
    if (!originalText.trim()) continue;

    const context = getContext(node);
    const screen = getScreenName(node);
    const slug = slugify(originalText);
    const key = `${screen}.${context}.${slug}`;

    if (!node.getPluginData('originalText')) {
      node.setPluginData('originalText', originalText);
    }
    // Store the nodeKey so we can identify this node in clones
    node.setPluginData('nodeKey', key);

    // Retrieve stored translations
    const storedTranslations: any = {};
    ['fr', 'de', 'hi', 'es'].forEach(lang => {
      const trans = node.getPluginData('translation-' + lang);
      if (trans) storedTranslations[lang] = trans;
    });

    results.push({
      id: node.id,
      text: originalText,
      key: key,
      context: context,
      translations: storedTranslations
    });
  }

  figma.ui.postMessage({ type: 'scan-results', data: results });
}

figma.ui.onmessage = async (msg) => {
  console.log('[Plugin Core] Message received:', msg.type);

  if (msg.type === 'scan') {
    figma.notify('Scanning design for text...', { timeout: 1000 });
    await scanSelection();
  }

  if (msg.type === 'apply-translation') {
    const { translations, language } = msg;
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      figma.notify('Please select the frame or elements you want to duplicate with translations.', { error: true });
      return;
    }

    figma.notify(`Duplicating selection for ${language.toUpperCase()}...`);
    console.log(`[Apply] Duplicating selection of ${selection.length} items`);

    try {
      const clones: SceneNode[] = [];

      for (const nodeToClone of selection) {
        console.log(`[Apply] Cloning: ${nodeToClone.name}`);
        const clone = nodeToClone.clone();
        clone.name = `${nodeToClone.name} (${language.toUpperCase()})`;

        // Move to appropriate parent and offset
        if (nodeToClone.parent) {
          nodeToClone.parent.appendChild(clone);
        }

        // Offset the clone to the right
        clone.x = nodeToClone.x + nodeToClone.width + 100;
        clone.y = nodeToClone.y;

        // Find all text nodes in the clone
        const cloneTextNodes = (clone as any).findAll ? (clone as any).findAll((n: any) => n.type === 'TEXT') : (clone.type === 'TEXT' ? [clone] : []);
        console.log(`[Apply] Found ${cloneTextNodes.length} text nodes within clone of ${nodeToClone.name}`);

        for (const textNode of cloneTextNodes) {
          try {
            const nodeKey = textNode.getPluginData('nodeKey');
            if (!nodeKey) continue;

            // Find matching translation by nodeKey
            // We use the original node reference if possible through the provided translation IDs
            const translationItem = await (async () => {
              for (const t of translations) {
                const originalNode = await figma.getNodeByIdAsync(t.id);
                if (originalNode && originalNode.getPluginData('nodeKey') === nodeKey) {
                  return t;
                }
              }
              return null;
            })();

            if (translationItem) {
              await figma.loadFontAsync(textNode.fontName as FontName);
              textNode.characters = translationItem.translatedText;
              textNode.setPluginData('translation-' + language, translationItem.translatedText);
            }
          } catch (nodeErr) {
            console.warn(`[Apply] Failed to process text node in clone:`, nodeErr);
          }
        }
        clones.push(clone);
      }

      figma.currentPage.selection = clones;
      figma.viewport.scrollAndZoomIntoView(clones);
      figma.notify(`${language.toUpperCase()} copies generated!`);
      figma.ui.postMessage({ type: 'apply-complete' });
    } catch (err: any) {
      console.error('[Apply] Critical error during selection duplication:', err);
      figma.notify(`Error: ${err.message}`, { error: true });
      figma.ui.postMessage({ type: 'apply-error', message: err.message });
    }
  }

  if (msg.type === 'store-translations') {
    const { data } = msg; // { fr: { id: text }, ... }
    for (const lang of Object.keys(data)) {
      for (const id of Object.keys(data[lang])) {
        const node = await figma.getNodeByIdAsync(id);
        if (node) {
          node.setPluginData('translation-' + lang, data[lang][id]);
        }
      }
    }
  }


  if (msg.type === 'close') {
    figma.closePlugin();
  }
};
