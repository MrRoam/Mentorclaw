#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetPath = r'D:/Desktop/Obsidian/北航/冯如杯/冯如杯资料/范文';

try {
  // Check path accessibility
  const windowsPath = r'D:\Desktop\Obsidian\北航\冯如杯\冯如杯资料\范文';
  const wslPath = '/mnt/d/Desktop/Obsidian/北航/冯如杯/冯如杯资料/范文';
  
  const pathCheckResult = {
    windows: {
      path: windowsPath,
      accessible: fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
    },
    wsl: {
      path: wslPath,
      accessible: false
    }
  };
  
  // List docx files
  const docxFiles = fs.readdirSync(targetPath)
    .filter(f => f.endsWith('.docx') && !f.startsWith('~$'))
    .sort();
  
  // Try to extract headings
  const sampledFiles = [];
  for (const filename of docxFiles.slice(0, 3)) {
    const filePath = path.join(targetPath, filename);
    let method = 'unavailable';
    let headings = [];
    
    try {
      // Try using pandoc
      const result = execSync(`pandoc "${filePath}" -t markdown`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      const lines = result.split('\n');
      for (const line of lines) {
        if (line.startsWith('#')) {
          const level = line.match(/^#+/)[0].length;
          const text = line.replace(/^#+\s*/, '').trim();
          if (text) headings.push({ level, text });
        }
      }
      method = 'pandoc';
    } catch (e) {
      // pandoc failed, try python-docx via Python
      try {
        const pythonCode = `
import json
from docx import Document
doc = Document('${filePath.replace(/\\/g, '\\\\')}')
headings = []
for para in doc.paragraphs:
    if 'Heading' in para.style.name:
        level = int(''.join(c for c in para.style.name if c.isdigit())) if any(c.isdigit() for c in para.style.name) else 0
        text = para.text.strip()
        if text:
            headings.append({'level': level, 'text': text})
print(json.dumps(headings, ensure_ascii=False))
`;
        const result = execSync(`python3 -c "${pythonCode.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
        headings = JSON.parse(result);
        method = 'python-docx';
      } catch (e2) {
        // Both failed
        method = 'unavailable';
      }
    }
    
    sampledFiles.push({
      filename,
      method,
      headings
    });
  }
  
  const output = {
    path_checks: pathCheckResult,
    docx_files: docxFiles,
    sampled_files: sampledFiles
  };
  
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    error: error.message,
    path_checks: {
      windows: { accessible: false },
      wsl: { accessible: false }
    },
    docx_files: [],
    sampled_files: []
  }, null, 2));
}
