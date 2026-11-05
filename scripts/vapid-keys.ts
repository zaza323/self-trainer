/** يولّد مفاتيح VAPID لـWeb Push (NOTIF-4). انسخ الناتج إلى .env.local (الخاص في الخادم فقط). */
import webpush from "web-push";
const k = webpush.generateVAPIDKeys();
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
