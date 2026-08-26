import {
  loadHeader,
  loadFooter,
  decorateButtons,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  getMetadata,
  createOptimizedPicture,
} from './aem.js';
import { setSubmitBaseUrl } from '../blocks/form/constant.js';

setSubmitBaseUrl('https://script.google.com/macros/s/AKfycbz0d-XBkYpKuxQVhOepjT-_HVZpsael3Soze9ngKuNMrGviyVRwRPp1C_ssn_qRREV-/exec');

/**
 * Moves all the attributes from a given elmenet to another given element.
 * @param {Element} from the element to copy attributes from
 * @param {Element} to the element to copy attributes to
 */
export function moveAttributes(from, to, attributes) {
  if (!attributes) {
    // eslint-disable-next-line no-param-reassign
    attributes = [...from.attributes].map(({ nodeName }) => nodeName);
  }
  attributes.forEach((attr) => {
    const value = from.getAttribute(attr);
    if (value) {
      to?.setAttribute(attr, value);
      from.removeAttribute(attr);
    }
  });
}

/**
 * Move instrumentation attributes from a given element to another given element.
 * @param {Element} from the element to copy attributes from
 * @param {Element} to the element to copy attributes to
 */
export function moveInstrumentation(from, to) {
  moveAttributes(
    from,
    to,
    [...from.attributes]
      .map(({ nodeName }) => nodeName)
      .filter((attr) => attr.startsWith('data-aue-') || attr.startsWith('data-richtext-')),
  );
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks() {
  try {
    // TODO: add auto block, if needed
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  // hopefully forward compatible button decoration
  decorateButtons(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
}

/**
 * Prepends a brand banner (logo, title, description) to the main element,
 * driven by page metadata. Opt-in: only renders when a `logo` metadata value
 * is present, so pages/brands without one are unaffected. Values normally
 * come from the site's bulk metadata sheet (cascaded per brand by URL) and
 * can be overridden per page via that page's own Page Metadata block.
 * @param {Element} main The main element
 */
function decorateBrandBanner(main) {
  const logo = getMetadata('logo');
  if (!logo) return;
  // The `title` bulk-metadata property is emitted as the <title> element,
  // not a <meta name="title"> tag, so it isn't readable via getMetadata().
  const { title } = document;
  const description = getMetadata('description');

  const banner = document.createElement('div');
  banner.className = 'brand-banner';
  banner.append(createOptimizedPicture(logo, title));
  if (title) {
    const heading = document.createElement('h1');
    heading.textContent = title;
    banner.append(heading);
  }
  if (description) {
    const paragraph = document.createElement('p');
    paragraph.textContent = description;
    banner.append(paragraph);
  }
  main.prepend(banner);
}

/**
 * Metadata property name -> CSS custom property name, for brand values that
 * can be set directly from the bulk metadata sheet with no CSS authoring.
 * This is what makes onboarding a new brand a pure authoring task: adding a
 * row to the metadata sheet is enough, no dev/CSS step required.
 */
const BRAND_STYLE_PROPERTIES = {
  'background-color': '--background-color',
  'text-color': '--text-color',
  'link-color': '--link-color',
  'card-background-color': '--card-background-color',
  font: '--body-font-family',
  // Only needed when a brand's font has a single weight registered (e.g.
  // a bold-only condensed webfont) - the form's default 400 label weight
  // wouldn't match that face, so the browser falls back to the next font
  // in the stack instead of using the real one.
  'label-font-weight': '--form-label-font-weight',
};

/**
 * Applies brand color/font overrides directly from page metadata, on top of
 * whatever `decorateTemplateAndTheme()` set via the (optional) `theme` class.
 * Fonts must already be available on the site (an existing /fonts file or an
 * already-linked font) - this does not load fonts dynamically.
 */
function decorateBrandStyle() {
  Object.entries(BRAND_STYLE_PROPERTIES).forEach(([metaName, cssProperty]) => {
    const value = getMetadata(metaName);
    if (value) document.documentElement.style.setProperty(cssProperty, value);
  });
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  decorateBrandStyle();
  const main = doc.querySelector('main');
  if (main) {
    decorateBrandBanner(main);
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadHeader(doc.querySelector('header'));
  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

loadPage();
