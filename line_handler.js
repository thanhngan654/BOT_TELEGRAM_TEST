module.exports = function(lineClient, menus, globalOrders, debts, saveOrders, saveDebts, footballEvent, saveFootball) {
    const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'thanhngan654,ngân nguyễn,ngan nguyen').split(',').map(s => s.trim().toLowerCase());
    function isAdmin(user) {
        return ADMIN_USERNAMES.includes(user.toLowerCase());
    }
    return async function handleLineEvent(event) {
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
                    text: `�🆔 LINE ID của nhóm/chat này là:\n${idToUse}\n\nHãy lưu vào biến môi trường LINE_GROUP_ID trên Render!`
                });
            }

            
            if (text === '/diemdanh') {
                if (footballEvent.isLocked) {
                    return lineClient.replyMessage(replyToken, { type: 'text', text: '⚠ Trận bóng đã chốt, không thể điểm danh thêm!' });
                }
                footballEvent.isActive = true;
                saveFootball();
                
                const flexMessage = {
                    type: 'flex',
                    altText: 'Điểm danh đá banh',
                    contents: {
                        type: 'bubble',
                        hero: {
                            type: 'image',
                            url: 'https://artlive.vn/wp-content/uploads/2024/03/image-116.png',
                            size: 'full',
                            aspectRatio: '20:13',
                            aspectMode: 'cover'
                        },
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: '⚽ ĐIỂM DANH ĐÁ BANH', weight: 'bold', size: 'xl' },
                                { type: 'text', text: 'Anh em bấm nút bên dưới để báo cáo quân số nhé!', wrap: true }
                            ]
                        },
                        footer: {
                            type: 'box',
                            layout: 'horizontal',
                            spacing: 'sm',
                            contents: [
                                { type: 'button', style: 'primary', action: { type: 'postback', label: '+1 người', data: 'fb_add' } },
                                { type: 'button', style: 'secondary', action: { type: 'postback', label: 'Cancel', data: 'fb_cancel' } }
                            ]
                        }
                    }
                };
                return lineClient.replyMessage(replyToken, flexMessage);
            }
            
            if (text === '/dsbanh') {
                if (!footballEvent.isActive) return lineClient.replyMessage(replyToken, { type: 'text', text: 'Chưa có trận bóng nào đang mở.' });
                
                let msgText = '⚽ DANH SÁCH ĐIỂM DANH BÓNG ĐÁ:\n\n';
                let totalSlots = 0;
                for (const [user, slots] of Object.entries(footballEvent.users)) {
                    msgText += `- ${user}: ${slots} người\n`;
                    totalSlots += slots;
                }
                
                if (totalSlots === 0) msgText += 'Chưa có ai điểm danh.\n';
                else msgText += `\n=> Tổng cộng: ${totalSlots} người (Dự kiến ${(totalSlots * 40).toLocaleString()}k)`;
                if (footballEvent.isLocked) msgText += '\n🔒 TRẬN ĐÃ CHỐT!';
                
                return lineClient.replyMessage(replyToken, { type: 'text', text: msgText });
            }
            
            if (text === '/huykeo') {
                if (!isAdmin(userName)) return lineClient.replyMessage(replyToken, { type: 'text', text: '❌ Bạn không có quyền Hủy kèo.' });
                
                footballEvent.isActive = false;
                footballEvent.isLocked = false;
                footballEvent.users = {};
                saveFootball();
                return lineClient.replyMessage(replyToken, { type: 'text', text: '🗑 Trận bóng đã bị hủy. Đã reset danh sách.' });
            }
            
            if (text === '/chotsan') {
                if (!isAdmin(userName)) return lineClient.replyMessage(replyToken, { type: 'text', text: '❌ Bạn không có quyền Chốt sân.' });
                
                if (!footballEvent.isActive || footballEvent.isLocked) {
                    return lineClient.replyMessage(replyToken, { type: 'text', text: 'Không có trận nào đang mở để chốt!' });
                }
                
                footballEvent.isLocked = true;
                let totalSlots = 0;
                for (const [u, slots] of Object.entries(footballEvent.users)) {
                    if (!debts[u]) debts[u] = 0;
                    debts[u] += slots * 40000;
                    totalSlots += slots;
                }
                saveFootball();
                saveDebts();
                
                return lineClient.replyMessage(replyToken, { type: 'text', text: `✅ ĐÃ CHỐT SÂN!\nTổng cộng ${totalSlots} người đã được cộng công nợ (40k/người) vào sổ.\nSử dụng /tienno để xem tổng nợ.` });
            }
            
            if (text === '/helpme') {
                const helpText = `📚 DANH SÁCH CÚ PHÁP:\n/menu - Xem menu gọi món\n/ds - Xem danh sách đặt món\n/huy - Hủy món đã đặt\n/diemdanh - Mở form điểm danh bóng đá\n/dsbanh - Xem danh sách bóng đá\n/tienno - Xem ai nợ bao nhiêu tiền\n/thanhtoan - Lấy QR code thanh toán nợ\n/huykeo (Admin) - Hủy trận bóng\n/chotsan (Admin) - Chốt bóng đá và cộng nợ\n/chotdon (Admin) - Chốt đơn cơm và cộng nợ\n/xacnhan Tên SốTiền (Admin) - Trừ nợ thủ công`;
                return lineClient.replyMessage(replyToken, { type: 'text', text: helpText });
            }
            
            if (text === '/tienno') {
                let msg = '💰 DANH SÁCH CÔNG NỢ:\n\n';
                let total = 0;
                let hasDebt = false;
                for (const user in debts) {
                    if (debts[user] > 0) {
                        msg += `👩🏻 ${user}: ${debts[user].toLocaleString()}đ\n`;
                        total += debts[user];
                        hasDebt = true;
                    }
                }
                if (!hasDebt) msg = '🎉 Tuyệt vời! Hiện tại không có ai nợ tiền.';
                else msg += `\n=> TỔNG NỢ: ${total.toLocaleString()}đ\n👉 Gõ /thanhtoan để lấy mã QR thanh toán.`;
                return lineClient.replyMessage(replyToken, { type: 'text', text: msg });
            }
            
            if (text === '/thanhtoan') {
                const amount = debts[userName] || 0;
                if (amount <= 0) return lineClient.replyMessage(replyToken, { type: 'text', text: `${userName} ơi, bạn không có nợ gì cả. Tuyệt vời! 🥳` });
                
                const bankId = 'MB';
                const accountNo = '03709868';
                const accountName = 'NGUYEN THANH NGAN';
                const addInfo = `${userName} thanh toan`.replace(/ /g, '%20');
                const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${addInfo}&accountName=${accountName.replace(/ /g, '%20')}`;
                
                return lineClient.replyMessage(replyToken, {
                    type: 'image',
                    originalContentUrl: qrUrl,
                    previewImageUrl: qrUrl
                });
            }
            
            const xacnhanMatch = text.match(/^\/xacnhan (.+) (\d+)$/);
            if (xacnhanMatch) {
                if (!isAdmin(userName)) return lineClient.replyMessage(replyToken, { type: 'text', text: '❌ Chỉ Admin mới được dùng lệnh này.' });
                const targetUser = xacnhanMatch[1].trim();
                const amount = parseInt(xacnhanMatch[2], 10);
                if (!debts[targetUser]) return lineClient.replyMessage(replyToken, { type: 'text', text: `Không tìm thấy nợ của ${targetUser}.` });
                debts[targetUser] = Math.max(0, debts[targetUser] - amount);
                saveDebts();
                return lineClient.replyMessage(replyToken, { type: 'text', text: `✅ Đã trừ ${amount.toLocaleString()}đ cho ${targetUser}. Nợ còn lại: ${debts[targetUser].toLocaleString()}đ.` });
            }
if (text === '/menu') {
                if (menus.length === 0) {
                    return lineClient.replyMessage(replyToken, { type: 'text', text: '⚡ Hiện chưa có danh sách quán ăn nào.' });
                }
                
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
                                action: { type: 'postback', label: 'Xem Menu & Đảt', data: `rest_${menu.id}` }
                            }
                        ]
                    }
                }));

                return lineClient.replyMessage(replyToken, {
                    type: 'flex',
                    altText: 'Hôm nay ăn gï?',
                    contents: { type: 'carousel', contents: bubbles }
                });
            }
            
            if (text === '/ds') {
                let msg = '📡 DANH SÁCH  ĐẬT CƠM:\n\n';
                let hasOrder = false;
                let totalAmount = 0;
                
                for (const restId in globalOrders) {
                    const restData = globalOrders[restId];
                    if (Object.keys(restData.users).length === 0) continue;
                    hasOrder = true;
                    msg += `🏪 ${restData.restName}\n`;
                    let restTotal = 0;
                    
                    for (const user in restData.users) {
                        const items = restData.users[user];
                        let userText = items.map(i => i.name).join(', ');
                        let userTotal = items.reduce((sum, i) => sum + i.price, 0);
                        restTotal += userTotal;
                        msg += `👩🏻 ${user}: ${userText} (${userTotal.toLocaleString()}ğ)\n`;
                    }
                    msg += `=> Tổng quán: ${restTotal.toLocaleString()}ğ\n\n`;
                    totalAmount += restTotal;
                }
                
                if (!hasOrder) msg = '📭 Hiện chưa có ai đặt cơm cả.';
                else msg += `� TổNG CỘNG TẤT C^Ả: ${totalAmount.toLocaleString()}ğ`;
                
                return lineClient.replyMessage(replyToken, { type: 'text', text: msg });
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
                    return lineClient.replyMessage(replyToken, { type: 'text', text: `✅ Đã hủy toàn bộ order của ${userName}!` });
                } else {
                    return lineClient.replyMessage(replyToken, { type: 'text', text: `⚡ ${userName} chưa đặt món nào cả!` });
                }
            }

            if (text.startsWith('/chotdon')) {
                const parts = text.split(' ');
                if (parts.length < 3) {
                    return lineClient.replyMessage(replyToken, { type: 'text', text: '⚡ Sai cú pháp! Hãy gõ: /chotdon <ID_Quán> <Tổng_tiền_thực_tế>' });
                }
                
                const restId = parts[1];
                const actualTotal = parseInt(parts[2].replace(/\\D/g, ''));
                
                const restData = globalOrders[restId];
                if (!restData || Object.keys(restData.users).length === 0) {
                    return lineClient.replyMessage(replyToken, { type: 'text', text: '⚨ Quán này chưa có ai đảt hoặc sai ID!' });
                }
                
                let currentTotal = 0;
                for (const u in restData.users) {
                    currentTotal += restData.users[u].reduce((s, i) => s + i.price, 0);
                }
                
                const diff = actualTotal - currentTotal;
                const userCount = Object.keys(restData.users).length;
                const diffPerUser = Math.round(diff / userCount);
                
                let billMsg = `🤗 CHỐT ĐơN: ${restData.restName}\n\n`;
                for (const u in restData.users) {
                    let userTotal = restData.users[u].reduce((s, i) => s + i.price, 0);
                    let finalUserTotal = userTotal + diffPerUser;
                    
                    debts[u] = (debts[u] || 0) + finalUserTotal;
                    billMsg += `👩🏻 ${u}: ${userTotal.toLocaleString()}ğg ${diffPerUser > 0 ? '+' : ''}${diffPerUser !== 0 ? diffPerUser.toLocaleString() + 'ğg (ship/mã)' : ''} = ${finalUserTotal.toLocaleString()}ğg\n`;
                }
                
                delete globalOrders[restId];
                saveOrders();
                saveDebts();
                
                billMsg += `\n💴 TổNG TIỀNG: ${actualTotal.toLocaleString()}ğg\n`;
                billMsg += '✅ Đã cộng tiền vào sổ nợ! Gõ /rc để lấy mã QR chuyển khoản.';
                return lineClient.replyMessage(replyToken, { type: 'text', text: billMsg });
            }

            if (text === '/rc') {
                if (Object.keys(debts).length === 0) {
                    return lineClient.replyMessage(replyToken, { type: 'text', text: '🎉 Chúc m�ng! Không có ai đang nợ tiền cģm cạ!' });
                }
                
                let msg = '📊 SOỔ NẢ HIỆN TẠI:\n\n';
                let totalDebts = 0;
                const bubbles = [];
                
                for (const userOwe in debts) {
                    const amount = debts[userOwe];
                    if (amount <= 0) continue;
                    totalDebts += amount;
                    msg += `👩🏻 ${userOwe}: ${amount.toLocaleString()}ğ\n`;
                    
                    const bankId = 'MB';
                    const accountNo = '03709868';
                    const accountName = 'NGUYEN THANH NGAN';
                    const addInfo = `${userOwe} thanh toan`.replace(/ /g, '%20');
                    const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${addInfo}&accountName=${accountName.replace(/ /g, '%20')}`;
                    
                    bubbles.push({
                        type: 'bubble',
                        size: 'micro',
                        header: {
                            type: 'box', layout: 'vertical', contents: [
                                { type: 'text', text: userOwe, weight: 'bold', size: 'sm', align: 'center', wrap: true }
                            ]
                        },
                        hero: {
                            type: 'image', url: qrUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover'
                        },
                        body: {
                            type: 'box', layout: 'vertical', contents: [
                                { type: 'text', text: `${amount.toLocaleString()}ğ`, weight: 'bold', size: 'sm', color: '#ff0000', align: 'center' }
                            ]
                        }
                    });
                }
                msg += `\n => Tổng nỡ: ${totalDebts.toLocaleString()}ğ\nLưu ý: Chuyển khoản quét QR tự động gạch nọ.` ;
                
                if (bubbles.length > 0) {
                    await lineClient.replyMessage(replyToken, [
                        { type: 'text', text: msg },
                        { type: 'flex', altText: 'Danh sách QR Code thanh toán', contents: { type: 'carousel', contents: bubbles.slice(0, 10) } }
                    ]);
                } else {
                    return lineClient.replyMessage(replyToken, { type: 'text', text: '🎉 Chúc mừng! Không có ai đang nọ tiền cơm cả!' });
                }
            }
        }

        if (event.type === 'postback') {
            const data = event.postback.data;
            const userId = event.source.userId;
            let userName = 'Khách';
            try { const profile = await lineClient.getProfile(userId); userName = profile.displayName; } catch(e) {}

            if (data === 'fb_add' || data === 'fb_cancel') {
                if (footballEvent.isLocked) return;
                let replyText = '';
                if (data === 'fb_add') {
                    footballEvent.users[userName] = (footballEvent.users[userName] || 0) + 1;
                    replyText = `Đã ghi nhận +1 cho ${userName}`;
                } else {
                    delete footballEvent.users[userName];
                    replyText = `Đã hủy điểm danh của ${userName}`;
                }
                saveFootball();
                return lineClient.replyMessage(event.replyToken, { type: 'text', text: replyText });
            }

            if (data.startsWith('rest_')) {
                const restId = data.replace('rest_', '');
                const menu = menus.find(m => m.id === restId);
                
                if (menu) {
                    const buttons = [];
                    for (let i = 0; i < Math.min(menu.items.length, 12); i++) {
                        const item = menu.items[i];
                        let btnText = item.name;
                        if (item.price) btnText = `[${item.price / 1000}k] ${item.name}`;
                        buttons.push({
                            type: 'button',
                            style: 'secondary',
                            margin: 'sm',
                            height: 'sm',
                            action: { type: 'postback', label: btnText.substring(0, 20), data: `i_${restId}_${item.id}`, displayText: `Đã chọn: ${item.name}` }
                        });
                    }
                    
                    const bubbles = [];
                    for (let i=0; i < buttons.length; i+=4) {
                        bubbles.push({
                            type: 'bubble',
                            body: {
                                type: 'box', layout: 'vertical', contents: buttons.slice(i, i+1)
                            }
                        });
                    }
                    
                    await lineClient.replyMessage(event.replyToken, {
                        type: 'flex',
                        altText: 'Chọn món',
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
                    
                    await lineClient.replyMessage(event.replyToken, { type: 'text', text: `✅ ${userName} vừa đảt ${item.name} tại ${menu.name}` });
                }
            }
        }
    };
};