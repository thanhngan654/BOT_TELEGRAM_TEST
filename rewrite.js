const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// 1. Update memory management
code = code.replace(
    /const ORDERS_FILE = path\.join\(__dirname, 'orders\.json'\);[\s\S]*?function saveOrders\(\) \{[\s\S]*?\n\}/,
`const ORDERS_FILE = path.join(__dirname, 'orders.json');
const MENU_FILE = path.join(__dirname, 'menu.json');
const DEBTS_FILE = path.join(__dirname, 'debts.json');

// --- QUẢN LÝ BỘ NHỚ ---
let menus = [];
let globalOrders = {}; // Dữ liệu mới: { restId: { restName: 'A', users: { username: [ {name, price} ] } } }
let debts = {};

try { menus = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8')); } catch (e) {}
try { if (fs.existsSync(ORDERS_FILE)) globalOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch (e) {}
try { if (fs.existsSync(DEBTS_FILE)) debts = JSON.parse(fs.readFileSync(DEBTS_FILE, 'utf8')); } catch (e) {}

function saveOrders() { fs.writeFileSync(ORDERS_FILE, JSON.stringify(globalOrders, null, 2)); }
function saveDebts() { fs.writeFileSync(DEBTS_FILE, JSON.stringify(debts, null, 2)); }`
);

// 2. Update callback query for pay_ and confirm_ and i_
code = code.replace(
    /        \} else if \(data\.startsWith\('i_'\)\) \{[\s\S]*?            \} catch \(e\) \{/,
`        } else if (data.startsWith('i_')) {
            const parts = data.split('_');
            const restId = parts[1];
            const itemId = parts.slice(2).join('_');
            
            const menu = menus.find(m => m.id === restId);
            const item = menu?.items.find(i => i.id === itemId);
            
            if (item && menu) {
                if (!globalOrders[restId]) globalOrders[restId] = { restName: menu.name, users: {} };
                if (!globalOrders[restId].users[user]) globalOrders[restId].users[user] = [];
                
                globalOrders[restId].users[user].push({ name: item.name, price: item.price || 0 });
                saveOrders();
                
                await bot.answerCallbackQuery(query.id, { text: \`✅ Đã thêm: \${item.name}\` });
                await bot.sendMessage(chatId, \`✅ @\${user} vừa đặt <b>\${item.name}</b> tại quán <b>\${menu.name}</b>\`, { parse_mode: 'HTML' });
            }
        } else if (data.startsWith('pay_')) {
            const userOwe = data.replace('pay_', '');
            const amount = debts[userOwe];
            
            if (!amount || amount <= 0) {
                return bot.answerCallbackQuery(query.id, { text: \`✅ @\${userOwe} đã thanh toán xong rồi!\`, show_alert: true });
            }
            
            const bankId = 'MB'; // MB Bank
            const accountNo = '03709868';
            const accountName = encodeURIComponent('NGUYEN THANH NGAN');
            const addInfo = encodeURIComponent(\`\${userOwe} thanh toan tien com\`);
            const qrUrl = \`https://img.vietqr.io/image/\${bankId}-\${accountNo}-compact2.png?amount=\${amount}&addInfo=\${addInfo}&accountName=\${accountName}\`;
            
            const inlineConfirm = [
                [{ text: \`✅ Admin Xác Nhận: @\${userOwe} Đã Chuyển \${amount.toLocaleString()}đ\`, callback_data: \`confirm_\${userOwe}\` }]
            ];
            
            await bot.sendPhoto(chatId, qrUrl, {
                caption: \`📸 Mã QR thanh toán tự động cho <b>@\${userOwe}</b>\\n💰 Số tiền nợ: <b>\${amount.toLocaleString()}đ</b>\`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: inlineConfirm }
            });
            await bot.answerCallbackQuery(query.id);
            
        } else if (data.startsWith('confirm_')) {
            const userOwe = data.replace('confirm_', '');
            
            if (!debts[userOwe] || debts[userOwe] <= 0) {
                return bot.answerCallbackQuery(query.id, { text: \`⚠ Người này đã được xác nhận trước đó rồi!\`, show_alert: true });
            }
            
            debts[userOwe] = 0; // Xóa nợ
            saveDebts();
            
            await bot.answerCallbackQuery(query.id, { text: \`✅ Đã xác nhận thanh toán!\` });
            
            // Xóa nút bấm xác nhận để tránh bấm 2 lần
            await bot.editMessageCaption(\`✅ <b>Admin đã xác nhận @\${userOwe} thanh toán xong!</b>\`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
            });
        }
    } catch (e) {`
);

// 3. Delete old /ds, /huy, /chotdon and add new ones + /rc
code = code.replace(
    /bot\.onText\(\/\\\/ds\/, async \(msg\) => \{[\s\S]*?bot\.onText\(\/\\\/id\/, async \(msg\) => \{/,
`bot.onText(/\\/ds/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        
        if (Object.keys(globalOrders).length === 0) {
            return bot.sendMessage(chatId, '📭 Hiện chưa có ai đặt món nào!');
        }
        
        let text = '📋 <b>DANH SÁCH ĐẶT CƠM (CHƯA CHỐT)</b>\\n\\n';
        let restIndex = 1;
        
        for (const [restId, restData] of Object.entries(globalOrders)) {
            let restTotal = 0;
            text += \`🏪 <b>[ID: \${restIndex}] \${restData.restName}</b>\\n\`;
            
            for (const [user, items] of Object.entries(restData.users)) {
                if (items.length > 0) {
                    let userTotal = 0;
                    text += \`👤 @\${user}:\\n\`;
                    items.forEach(item => {
                        text += \`  - \${item.name} (\${item.price.toLocaleString()}đ)\\n\`;
                        userTotal += item.price;
                    });
                    restTotal += userTotal;
                }
            }
            text += \`👉 <b>Tổng gốc quán này: \${restTotal.toLocaleString()}đ</b>\\n\`;
            text += \`📝 <i>Chốt đơn quán này: /chotdon \${restIndex} [Tổng_Tiền_Đã_Giảm]</i>\\n\\n\`;
            restIndex++;
        }
        
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\\/huy/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const user = msg.from.username || msg.from.first_name || 'Khách';
        
        let removedItem = null;
        let removedRestName = '';
        
        for (const restId in globalOrders) {
            if (globalOrders[restId].users[user] && globalOrders[restId].users[user].length > 0) {
                removedItem = globalOrders[restId].users[user].pop();
                removedRestName = globalOrders[restId].restName;
                
                if (globalOrders[restId].users[user].length === 0) delete globalOrders[restId].users[user];
                if (Object.keys(globalOrders[restId].users).length === 0) delete globalOrders[restId];
                break;
            }
        }
        
        if (removedItem) {
            saveOrders();
            await bot.sendMessage(chatId, \`🗑 @\${user} đã hủy món: <b>\${removedItem.name}</b> (tại \${removedRestName})\`, { parse_mode: 'HTML' });
        } else {
            await bot.sendMessage(chatId, \`⚠ @\${user} chưa đặt món nào để hủy!\`);
        }
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\\/chotdon(?:\\s+(\\d+)\\s+(\\d+))?/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        
        if (!match[1] || !match[2]) {
            return bot.sendMessage(chatId, '⚠ Cú pháp sai! Vui lòng dùng: \`/chotdon <ID_Quán> <Số_tiền_thực_tế>\`\\nVí dụ: \`/chotdon 1 100000\`', { parse_mode: 'Markdown' });
        }
        
        const targetIndex = parseInt(match[1]);
        const finalPrice = parseInt(match[2]);
        
        const restIds = Object.keys(globalOrders);
        if (targetIndex < 1 || targetIndex > restIds.length) {
            return bot.sendMessage(chatId, \`⚠ Không tìm thấy ID quán là \${targetIndex}! Gõ /ds để xem.\`);
        }
        
        const restId = restIds[targetIndex - 1];
        const restData = globalOrders[restId];
        
        let originalTotal = 0;
        let userTotals = {};
        
        for (const [user, items] of Object.entries(restData.users)) {
            let uTotal = items.reduce((sum, item) => sum + item.price, 0);
            userTotals[user] = uTotal;
            originalTotal += uTotal;
        }
        
        if (originalTotal === 0) {
            return bot.sendMessage(chatId, \`⚠ Quán này không có đơn.\`);
        }
        
        const ratio = finalPrice / originalTotal;
        
        let reportText = \`✅ <b>ĐÃ CHỐT ĐƠN: \${restData.restName}</b>\\n\`;
        reportText += \`💰 Tổng gốc: \${originalTotal.toLocaleString()}đ -> <b>Thực thu: \${finalPrice.toLocaleString()}đ</b> (Tỷ lệ thực trả ~\$((ratio * 100).toFixed(1)}%)\\n\\n\`;
        
        for (const [user, uTotal] of Object.entries(userTotals)) {
            if (uTotal > 0) {
                const finalUserDebt = Math.round(uTotal * ratio);
                debts[user] = (debts[user] || 0) + finalUserDebt;
                reportText += \`👤 @\${user}: nợ <b>\${finalUserDebt.toLocaleString()}đ</b>\\n\`;
            }
        }
        
        reportText += \`\\n<i>Số tiền nợ đã cộng vào danh sách. Gõ /rc để thanh toán!</i>\`;
        
        delete globalOrders[restId];
        saveOrders();
        saveDebts();
        
        await bot.sendMessage(chatId, reportText, { parse_mode: 'HTML' });
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\\/rc/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        
        const debtors = Object.keys(debts).filter(u => debts[u] > 0);
        if (debtors.length === 0) {
            return bot.sendMessage(chatId, '🎉 Hiện tại không có ai nợ tiền cơm!');
        }
        
        let text = '💸 <b>DANH SÁCH NHẮC NỢ (Click để lấy mã QR chuyển khoản):</b>\\n\\n';
        
        const inlineKeyboard = debtors.map(user => ([
            { text: \`Thanh toán cho @\${user} (\${debts[user].toLocaleString()}đ)\`, callback_data: \`pay_\${user}\` }
        ]));
        
        await bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    } catch (e) {
        console.error(e);
    }
});

bot.onText(/\\/id/, async (msg) => {`
);

// 4. Help text update
code = code.replace(
    /- \/chotdon: \(Dành cho Admin\) Xóa trắng danh sách để bắt đầu ngày mới\./,
    `- /chotdon <ID> <Tiền>: (Admin) Chốt hóa đơn của 1 quán và chia đều mã giảm giá\n` +
    `                       - /rc: Hiển thị danh sách nợ & Mã QR thanh toán.`
);

fs.writeFileSync('index.js', code);
console.log('Update Complete');
