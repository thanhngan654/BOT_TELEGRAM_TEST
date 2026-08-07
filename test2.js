const fs = require('fs');
const data = fs.readFileSync('dump.json', 'utf8');
const match = data.match(/"name":"[^"]*"/g);
if (match) {
    console.log(match.slice(0, 20));
} else {
    console.log("No names found");
}
