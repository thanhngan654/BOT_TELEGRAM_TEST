const axios = require('axios');

axios.get('https://food.grab.com/vn/en/restaurant/online-delivery/5-C3EVFB5KRJNUCN', {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
}).then(res => {
    const match = res.data.match(/__NEXT_DATA__"[^>]*>({.*?)<\/script>/);
    if(match) {
        const json = JSON.parse(match[1]);
        console.log(Object.keys(json.props.initialReduxState.pageRestaurantDetail.entities || {}));
    } else {
        console.log('No next data');
    }
}).catch(e => console.log(e.message));
