// Symuluje callback z chmury TTLock – do testów bez zamka.
const cfg = flow.get('config') || {};
const lockId = cfg.lockId || '1234567';
const teraz = Date.now();
const scenariusze = {
    palec:    { recordType: 8,  username: 'Anna - kciuk',  keyboardPwd: '44668054142981' },
    pin:      { recordType: 4,  username: 'Piotr kod',     keyboardPwd: '123456' },
    srodek:   { recordType: 32, username: '',              keyboardPwd: '' },
    nieznany: { recordType: 7,  username: 'Gosc brelok',   keyboardPwd: '0012345678' },
};
const s = scenariusze[msg.topic] || scenariusze.palec;
msg.payload = {
    lockId: String(lockId),
    notifyType: '1',
    lockMac: 'AA:BB:CC:DD:EE:FF',
    records: JSON.stringify([Object.assign({
        lockId: Number(lockId), success: 1, lockDate: teraz - 2000,
        serverDate: teraz - 500, electricQuantity: 100,
    }, s)]),
};
return msg;
