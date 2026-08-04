import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const installedRoot = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const chromiumDirectory = fs.readdirSync(installedRoot).filter((name) => /^chromium-\d+$/.test(name)).sort().at(-1);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? path.join(installedRoot, chromiumDirectory ?? '', 'chrome-win64', 'chrome.exe');
const outputDirectory = path.resolve('public');
fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath });
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:transparent;overflow:hidden}canvas{display:block}</style><canvas width="${size}" height="${size}"></canvas>`);
    await page.locator('canvas').evaluate((canvas, iconSize) => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const radius = iconSize * 0.19;
      const roundedRect = (x, y, width, height, corner) => {
        context.beginPath();
        context.roundRect(x, y, width, height, corner);
        context.closePath();
      };
      roundedRect(iconSize * 0.12, iconSize * 0.13, iconSize * 0.78, iconSize * 0.78, radius);
      context.fillStyle = '#174a48';
      context.fill();
      roundedRect(iconSize * 0.05, iconSize * 0.05, iconSize * 0.78, iconSize * 0.78, radius);
      context.fillStyle = '#e85d4a';
      context.fill();
      context.fillStyle = '#fff7ea';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `700 ${iconSize * 0.55}px KaiTi, STKaiti, serif`;
      context.fillText('织', iconSize * 0.44, iconSize * 0.45);
    }, size);
    await page.locator('canvas').screenshot({ path: path.join(outputDirectory, `icon-${size}.png`), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
