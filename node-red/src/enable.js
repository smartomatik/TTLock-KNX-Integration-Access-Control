// Zapamiętuje stan GA "automatyka włączona" (DPT 1.001) odebrany z KNX.
const v = msg.payload;
const wl = v === true || v === 1 || v === '1' || v === 'true';
flow.set('automatykaWlaczona', wl);
node.status({ fill: wl ? 'green' : 'red', shape: 'dot', text: wl ? 'automatyka WŁ' : 'automatyka WYŁ' });
return null;
