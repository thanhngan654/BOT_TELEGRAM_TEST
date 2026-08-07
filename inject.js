const fs = require('fs');
const code = fs.readFileSync('C:/Users/ACER/.gemini/antigravity/brain/395f534a-c827-4c88-ba61-19e0fef0c333/grab_bookmarklet.js', 'utf8');
const encoded = encodeURIComponent(code);
let html = fs.readFileSync('C:/Users/ACER/.gemini/antigravity/brain/395f534a-c827-4c88-ba61-19e0fef0c333/setup_bookmarklet.html', 'utf8');
html = html.replace('// JS_INJECT_PLACEHOLDER', 'const code = decodeURIComponent("' + encoded + '"); document.getElementById("bookmarkletLink").setAttribute("href", "javascript:(function(){" + encodeURIComponent(code) + "})();");');
fs.writeFileSync('C:/Users/ACER/.gemini/antigravity/brain/395f534a-c827-4c88-ba61-19e0fef0c333/setup_bookmarklet.html', html);
