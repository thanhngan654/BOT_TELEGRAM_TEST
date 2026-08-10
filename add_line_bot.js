const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const lineInitCode = 
// --- LINE BOT CONFIG ---
const line = require('@line/bot-sdk');
const lineConfig = {
    channelAccessToken: process.env.LINE_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};
const lineClient = (lineConfig.channelAccessToken && lineConfig.channelSecret) ? new line.Client(lineConfig) : null;
const LINE_GROUP_ID = process.env.LINE_GROUP_ID;
;

code = code.replace(/const app = express\(\);/, lineInitCode + '\nconst app = express();');

const lineWebhookCode = 
// --- LINE WEBHOOK ---
if (lineConfig.channelAccessToken && lineConfig.channelSecret) {
    app.post('/api/line/webhook', line.middleware(lineConfig), async (req, res) => {
        Promise.all(req.body.events.map(handleLineEvent))
            .then(() => res.status(200).end())
            .catch((err) => {
                console.error(err);
                res.status(500).end();
            });
    });
}

async function handleLineEvent(event) {
    if (event.type === 'message' && event.message.type === 'text') {
        const text = event.message.text.trim();
        const userId = event.source.userId;
        const groupId = event.source.groupId || event.source.roomId;
        const replyToken = event.replyToken;
        
        let userName = 'Khách';
        try {
            const profile = await lineClient.getProfile(userId);
            userName = profile.displayName;
        } catch(e) {}

        if (text === '/id') {
            const idToUse = groupId || userId;
            return lineClient.replyMessage(replyToken, {
                type: 'text',
                text: \?? LINE ID c?a nhóm/chat này là:\\n\\\n\\nHãy luu vào bi?n môi tru?ng LINE_GROUP_ID\
            });
        }

        if (text === '/menu') {
            if (menus.length === 0) {
                return lineClient.replyMessage(replyToken, { type: 'text', text: '? Hi?n chua có danh sách quán an nào.' });
            }
            
            // Create a Flex Message carousel for restaurants
            const bubbles = menus.map(menu => ({
                type: 'bubble',
                hero: {
                    type: 'image',
                    url: menu.banner_image || 'https://via.placeholder.com/1024x768?text=Restaurant',
                    size: 'full',
                    aspectRatio: '20:13',
                    aspectMode: 'cover'
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        { type: 'text', text: menu.name, weight: 'bold', size: 'xl', wrap: true }
                    ]
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'sm',
                    contents: [
                        {
                            type: 'button',
                            style: 'primary',
                            height: 'sm',
                            action: { type: 'postback', label: 'Xem Menu & Ð?t', data: \est_\\ }
                        }
                    ]
                }
            }));

            return lineClient.replyMessage(replyToken, {
                type: 'flex',
                altText: 'Hôm nay an gì?',
                contents: { type: 'carousel', contents: bubbles }
            });
        }
        
        if (text === '/ds') {
            let msg = '?? <b>DANH SÁCH Ð?T COM:</b>\\n\\n';
            let hasOrder = false;
            let totalAmount = 0;
            
            for (const restId in globalOrders) {
                const restData = globalOrders[restId];
                if (Object.keys(restData.users).length === 0) continue;
                hasOrder = true;
                msg += \?? <b>\</b>\\n\;
                let restTotal = 0;
                
                for (const user in restData.users) {
                    const items = restData.users[user];
                    let userText = items.map(i => i.name).join(', ');
                    let userTotal = items.reduce((sum, i) => sum + i.price, 0);
                    restTotal += userTotal;
                    msg += \?? \: \ (\d)\\n\;
                }
                msg += \=> T?ng quán: \d\\n\\n\;
                totalAmount += restTotal;
            }
            
            if (!hasOrder) msg = '?? Hi?n chua có ai d?t com c?.';
            else msg += \?? <b>T?NG C?NG T?T C?: \d</b>\;
            
            // Flex text message for /ds since LINE doesn't parse HTML in plain text well without Flex
            return lineClient.replyMessage(replyToken, { type: 'text', text: msg.replace(/<[^>]*>?/gm, '') });
        }

        if (text === '/huy') {
            let found = false;
            for (const restId in globalOrders) {
                if (globalOrders[restId].users[userName]) {
                    delete globalOrders[restId].users[userName];
                    found = true;
                }
            }
            if (found) {
                saveOrders();
                return lineClient.replyMessage(replyToken, { type: 'text', text: \? Ðã h?y toàn b? order c?a \!\ });
            } else {
                return lineClient.replyMessage(replyToken, { type: 'text', text: \? \ chua d?t món nào c?!\ });
            }
        }

        if (text.startsWith('/chotdon')) {
            const parts = text.split(' ');
            if (parts.length < 3) {
                return lineClient.replyMessage(replyToken, { type: 'text', text: '? Sai cú pháp! Hãy gõ: /chotdon <ID_Quán> <T?ng_ti?n_th?c_t?>' });
            }
            
            const restId = parts[1];
            const actualTotal = parseInt(parts[2].replace(/\\D/g, ''));
            
            const restData = globalOrders[restId];
            if (!restData || Object.keys(restData.users).length === 0) {
                return lineClient.replyMessage(replyToken, { type: 'text', text: '? Quán này chua có ai d?t ho?c sai ID!' });
            }
            
            let currentTotal = 0;
            for (const u in restData.users) {
                currentTotal += restData.users[u].reduce((s, i) => s + i.price, 0);
            }
            
            const diff = actualTotal - currentTotal;
            const userCount = Object.keys(restData.users).length;
            const diffPerUser = Math.round(diff / userCount);
            
            let billMsg = \?? <b>CH?T ÐON: \</b>\\n\\n\;
            for (const u in restData.users) {
                let userTotal = restData.users[u].reduce((s, i) => s + i.price, 0);
                let finalUserTotal = userTotal + diffPerUser;
                
                debts[u] = (debts[u] || 0) + finalUserTotal;
                billMsg += \?? \: \d \\ = \d\\n\;
            }
            
            delete globalOrders[restId];
            saveOrders();
            saveDebts();
            
            billMsg += \\\n?? <b>T?NG TI?N: \d</b>\\n\;
            billMsg += '? Ðã c?ng ti?n vào s? n?! Gõ /rc d? l?y mã QR chuy?n kho?n.';
            return lineClient.replyMessage(replyToken, { type: 'text', text: billMsg.replace(/<[^>]*>?/gm, '') });
        }

        if (text === '/rc') {
            if (Object.keys(debts).length === 0) {
                return lineClient.replyMessage(replyToken, { type: 'text', text: '?? Chúc m?ng! Không có ai dang n? ti?n com c?!' });
            }
            
            let msg = '?? <b>S? N? HI?N T?I:</b>\\n\\n';
            let totalDebts = 0;
            const bubbles = [];
            
            for (const userOwe in debts) {
                const amount = debts[userOwe];
                if (amount <= 0) continue;
                totalDebts += amount;
                msg += \?? \: \d\\n\;
                
                const bankId = 'MB';
                const accountNo = '03709868';
                const accountName = encodeURIComponent('NGUYEN THANH NGAN');
                const addInfo = encodeURIComponent(\\ thanh toan\);
                const qrUrl = \https://img.vietqr.io/image/\-\-compact2.png?amount=\&addInfo=\&accountName=\\;
                
                bubbles.push({
                    type: 'bubble',
                    size: 'micro',
                    header: {
                        type: 'box', layout: 'vertical', contents: [
                            { type: 'text', text: userOwe, weight: 'bold', size: 'sm', align: 'center' }
                        ]
                    },
                    hero: {
                        type: 'image', url: qrUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover'
                    },
                    body: {
                        type: 'box', layout: 'vertical', contents: [
                            { type: 'text', text: \\d\, weight: 'bold', size: 'sm', color: '#ff0000', align: 'center' }
                        ]
                    }
                });
            }
            msg += \\\n=> T?ng n?: \d\\nLuu ý: Chuy?n kho?n quét QR b?ng app ngân hàng t? d?ng g?ch n? (d?i 1-3 phút).\;
            
            if (bubbles.length > 0) {
                // Send text summary then Carousel of QRs
                await lineClient.replyMessage(replyToken, [
                    { type: 'text', text: msg.replace(/<[^>]*>?/gm, '') },
                    { type: 'flex', altText: 'Danh sách QR Code thanh toán', contents: { type: 'carousel', contents: bubbles.slice(0, 10) } } // LINE limits to 10 bubbles max
                ]);
            } else {
                return lineClient.replyMessage(replyToken, { type: 'text', text: '?? Chúc m?ng! Không có ai dang n? ti?n com c?!' });
            }
        }
    }

    if (event.type === 'postback') {
        const data = event.postback.data;
        const userId = event.source.userId;
        let userName = 'Khách';
        try { const profile = await lineClient.getProfile(userId); userName = profile.displayName; } catch(e) {}

        if (data.startsWith('rest_')) {
            const restId = data.replace('rest_', '');
            const menu = menus.find(m => m.id === restId);
            
            if (menu) {
                const buttons = [];
                for (let i = 0; i < Math.min(menu.items.length, 12); i++) {
                    const item = menu.items[i];
                    let btnText = item.name;
                    if (item.price) btnText = \[\k] \\;
                    buttons.push({
                        type: 'button',
                        style: 'secondary',
                        margin: 'sm',
                        height: 'sm',
                        action: { type: 'postback', label: btnText.substring(0, 20), data: \i_\_\\, displayText: \Ðã ch?n: \\ }
                    });
                }
                
                // Chunk buttons into multiple bubbles if needed (LINE allows max 100 components, but visual clarity limits us)
                const bubbles = [];
                for (let i=0; i < buttons.length; i+=4) {
                    bubbles.push({
                        type: 'bubble',
                        body: {
                            type: 'box', layout: 'vertical', contents: buttons.slice(i, i+4)
                        }
                    });
                }
                
                await lineClient.replyMessage(event.replyToken, {
                    type: 'flex',
                    altText: 'Ch?n món',
                    contents: { type: 'carousel', contents: bubbles }
                });
            }
        } else if (data.startsWith('i_')) {
            const parts = data.split('_');
            const restId = parts[1];
            const itemId = parts.slice(2).join('_');
            
            const menu = menus.find(m => m.id === restId);
            const item = menu?.items.find(i => i.id === itemId);
            
            if (item && menu) {
                if (!globalOrders[restId]) globalOrders[restId] = { restName: menu.name, users: {} };
                if (!globalOrders[restId].users[userName]) globalOrders[restId].users[userName] = [];
                
                globalOrders[restId].users[userName].push({ name: item.name, price: item.price || 0 });
                saveOrders();
                
                // Reply without replyToken if we use pushMessage? No, postback has replyToken
                await lineClient.replyMessage(event.replyToken, { type: 'text', text: \? \ v?a d?t \ t?i \\ });
            }
        }
    }
}
;

// Insert the webhook code before app.use(express.json())
code = code.replace(/app\.use\(express\.json\(\)\);/, lineWebhookCode + '\napp.use(express.json());');

// Update SePay webhook to also notify LINE
const sepayNotifyLine = 
            try {
                if (lineClient && LINE_GROUP_ID) {
                    await lineClient.pushMessage(LINE_GROUP_ID, { type: 'text', text: successMsg });
                }
            } catch(e) { console.error('L?i g?i LINE:', e.message); }
;
code = code.replace(/await bot\.sendMessage\(TELEGRAM_CHAT_ID, successMsg\);/, "await bot.sendMessage(TELEGRAM_CHAT_ID, successMsg);" + sepayNotifyLine);

fs.writeFileSync('index.js', code);
