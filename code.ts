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
    if (node.fontName !== figma.mixed) {
      const font = node.fontName as FontName;
      if (font && font.family) {
        uniqueFonts.set(`${font.family}_${font.style}`, font);
      }
    } else {
      // For mixed fonts, we need to load all fonts used in the node
      // For simplicity in a hackathon plugin, we'll try to load the common Fallback or skip if too complex
      // Better: figma.loadFontAsync(node.getRangeFontName(0, 1) as FontName)
    }
  });

  try {
    await Promise.all(
      Array.from(uniqueFonts.values()).map(font => figma.loadFontAsync(font).catch(err => {
        console.warn('[Plugin Core] Failed to load font:', font, err);
      }))
    );
  } catch (err) {
    console.error('[Plugin Core] Font loading batch error:', err);
  }

  const results = [];
  for (const node of textNodes) {
    try {
      const originalText = node.characters;
      if (!originalText || !originalText.trim()) continue;

      const context = getContext(node);
      const screen = getScreenName(node);
      const slug = slugify(originalText);
      const key = `${screen}.${context}.${slug}`;

      if (!node.getPluginData('originalText')) {
        node.setPluginData('originalText', originalText);
      }
      // Store the nodeKey so we can identify this node in clones
      node.setPluginData('nodeKey', key);

      // Retrieve stored translations and manual flags
      const storedTranslations: any = {};
      const manualFlags: any = {};
      ['fr', 'de', 'hi', 'es'].forEach(lang => {
        const trans = node.getPluginData('translation-' + lang);
        if (trans) storedTranslations[lang] = trans;

        const isManual = node.getPluginData('isManual-' + lang);
        if (isManual === 'true') manualFlags[lang] = true;
      });

      results.push({
        id: node.id,
        text: originalText,
        key: key,
        context: context,
        translations: storedTranslations,
        manualFlags: manualFlags
      });
    } catch (nodeErr) {
      console.error('[Plugin Core] Error processing node:', node.id, nodeErr);
    }
  }

  figma.ui.postMessage({ type: 'scan-results', data: results });
}

figma.ui.onmessage = async (msg) => {
  console.log('[Plugin Core] Message received:', msg.type);

  switch (msg.type) {
    case 'scan':
      figma.notify('Scanning design for text...', { timeout: 1000 });
      await scanSelection();
      break;

    case 'apply-translation':
      await handleApplyTranslation(msg);
      break;

    case 'store-translations':
      await handleStoreTranslations(msg);
      break;

    case 'preview-translation':
      await handlePreviewTranslation(msg);
      break;

    case 'revert-preview':
      await handleRevertPreview();
      break;

    case 'update-manual-translation':
      await handleUpdateManualTranslation(msg);
      break;

    case 'clear-storage':
      await handleClearStorage();
      break;

    case 'close':
      figma.closePlugin();
      break;
  }
};

async function handleApplyTranslation(msg: any) {
  const { translations, language } = msg;
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify('Please select elements to duplicate.', { error: true });
    return;
  }

  figma.notify(`Creating ${language.toUpperCase()} copy...`);

  try {
    const clones: SceneNode[] = [];
    for (const nodeToClone of selection) {
      const clone = nodeToClone.clone();
      clone.name = `${nodeToClone.name} (${language.toUpperCase()})`;
      if (nodeToClone.parent) nodeToClone.parent.appendChild(clone);
      clone.x = nodeToClone.x + nodeToClone.width + 100;
      clone.y = nodeToClone.y;

      const cloneTextNodes = (clone as any).findAll ?
        (clone as any).findAll((n: any) => n.type === 'TEXT') :
        (clone.type === 'TEXT' ? [clone] : []);

      for (const textNode of cloneTextNodes) {
        const nodeKey = textNode.getPluginData('nodeKey');
        if (!nodeKey) continue;

        // Find matching translation by nodeKey
        for (const t of translations) {
          const originalNode = await figma.getNodeByIdAsync(t.id);
          if (originalNode && originalNode.getPluginData('nodeKey') === nodeKey) {
            await figma.loadFontAsync(textNode.fontName as FontName);
            textNode.characters = t.translatedText;
            textNode.setPluginData('translation-' + language, t.translatedText);
            break;
          }
        }
      }
      clones.push(clone);
    }

    figma.currentPage.selection = clones;
    figma.viewport.scrollAndZoomIntoView(clones);
    figma.notify(`${language.toUpperCase()} copies generated!`);
    figma.ui.postMessage({ type: 'apply-complete' });
  } catch (err: any) {
    console.error('[Apply] Error:', err);
    figma.notify(`Error: ${err.message}`, { error: true });
    figma.ui.postMessage({ type: 'apply-error', message: err.message });
  }
}

async function handleStoreTranslations(msg: any) {
  const { data } = msg;
  for (const lang of Object.keys(data)) {
    for (const id of Object.keys(data[lang])) {
      const node = await figma.getNodeByIdAsync(id);
      if (node) node.setPluginData('translation-' + lang, data[lang][id]);
    }
  }
}

async function handlePreviewTranslation(msg: any) {
  const { translations, language } = msg;
  figma.notify(`Previewing ${language.toUpperCase()}...`);
  for (const item of translations) {
    const node = (await figma.getNodeByIdAsync(item.id)) as TextNode;
    if (node && node.type === 'TEXT') {
      if (!node.getPluginData('originalText')) {
        node.setPluginData('originalText', node.characters);
      }
      await figma.loadFontAsync(node.fontName as FontName);
      node.characters = item.translatedText;
    }
  }
}

async function handleRevertPreview() {
  figma.notify('Reverting design...');
  const nodesToRevert: TextNode[] = [];

  function findRevertible(node: SceneNode) {
    if (node.type === 'TEXT' && node.getPluginData('originalText')) {
      nodesToRevert.push(node);
    } else if ('children' in node) {
      for (const child of (node as any).children) {
        findRevertible(child);
      }
    }
  }

  figma.currentPage.children.forEach(findRevertible);

  for (const node of nodesToRevert) {
    const original = node.getPluginData('originalText');
    if (original) {
      await figma.loadFontAsync(node.fontName as FontName);
      node.characters = original;
    }
  }
  figma.notify('Design reverted');
}

async function handleUpdateManualTranslation(msg: any) {
  const { id, lang, text } = msg;
  const node = await figma.getNodeByIdAsync(id);
  if (node) {
    node.setPluginData('translation-' + lang, text);
    node.setPluginData('isManual-' + lang, 'true');
    console.log(`[Plugin Core] Manual override saved for ${id} in ${lang}`);
  }
}

async function handleClearStorage() {
  figma.notify('Cleaning up all design metadata...', { timeout: 2000 });

  function clearNode(node: SceneNode) {
    node.setPluginData('originalText', '');
    node.setPluginData('nodeKey', '');
    ['fr', 'de', 'hi', 'es'].forEach(lang => {
      node.setPluginData('translation-' + lang, '');
      node.setPluginData('isManual-' + lang, '');
    });

    if ('children' in node) {
      for (const child of node.children) {
        clearNode(child as SceneNode);
      }
    }
  }

  figma.currentPage.children.forEach(clearNode);
  figma.notify('All plugin data cleared from design!');
}
