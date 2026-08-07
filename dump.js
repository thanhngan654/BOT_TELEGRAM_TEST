const axios = require('axios');
const fs = require('fs');

axios.get('https://food.grab.com/vn/en/restaurant/online-delivery/5-C3EVFB5KRJNUCN', {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html'
    }
}).then(res => {
    const match = res.data.match(/__NEXT_DATA__"[^>]*>({.*?)<\/script>/);
    if(match) {
        fs.writeFileSync('dump.json', match[1]);
        console.log('Dumped successfully');
    } else {
        console.log('No __NEXT_DATA__ match');
    }
}).catch(e => console.log(e.message));
