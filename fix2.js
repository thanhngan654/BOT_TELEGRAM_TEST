const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

code = code.replace(
    /for \(const restId in globalOrders\) \{/,
    `for (const restId in globalOrders) {
            if (!globalOrders[restId] || typeof globalOrders[restId].users === 'undefined') {
                globalOrders = {};
                saveOrders();
                return bot.sendMessage(chatId, '🧹 Giỏ hàng cũ không tương thích đã được dọn dẹp! Vui lòng chọn món lại từ menu.');
            }`
);

code = code.replace(
    /const restData = globalOrders\[restId\];\s+let originalTotal = 0;/,
    `const restData = globalOrders[restId];
        if (!restData || typeof restData.users === 'undefined') {
            globalOrders = {};
            saveOrders();
            return bot.sendMessage(chatId, '🧹 Giỏ hàng cũ không tương thích đã được dọn dẹp! Vui lòng chọn món lại từ menu.');
        }
        
        let originalTotal = 0;`
);


fs.writeFileSync('index.js', code);
console.log('Fixed /huy and /chotdon');
