const puppeteer=require('puppeteer');
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 const p=await b.newPage(); await p.setViewport({width:1440,height:950});
 await p.goto('http://127.0.0.1:8099/index.html',{waitUntil:'load'});
 await p.evaluate(()=>{ localStorage.clear(); });
 await p.reload({waitUntil:'load'}); await new Promise(r=>setTimeout(r,400));
 await p.click('#goRegister'); await new Promise(r=>setTimeout(r,300));
 await p.type('#regName','Тест'); await p.type('#regUser','tst1'); await p.type('#regPass','pass123'); await p.type('#regPass2','pass123');
 await p.evaluate(()=>{const b=document.querySelector('#regTerms');b.checked=true;b.dispatchEvent(new Event('change',{bubbles:true}));});
 await p.click('#regBtn'); await p.waitForSelector('.topbar',{timeout:15000});
 await p.evaluate(()=>{logoutUser(); location.hash='#/login';});
 await new Promise(r=>setTimeout(r,600));
 await p.reload({waitUntil:'load'}); await new Promise(r=>setTimeout(r,1200));
 const info = await p.evaluate(()=>{
   const els=[...document.querySelectorAll('#loginUser')];
   return { count: els.length, rects: els.map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}),
     active: document.activeElement && document.activeElement.id,
     hash: location.hash, appChildren: document.getElementById('app').children.length };
 });
 console.log(JSON.stringify(info));
 await p.focus('#loginUser');
 await p.keyboard.type('tst1');
 await p.evaluate(()=>document.querySelector('#loginPass').focus());
 await p.keyboard.type('pass123');
 console.log('значения:', await p.evaluate(()=>({u:document.querySelector('#loginUser').value,p:document.querySelector('#loginPass').value})));
 await p.click('#loginBtn');
 await new Promise(r=>setTimeout(r,1500));
 console.log('после:', await p.evaluate(()=>({hash:location.hash, session:!!DB.session, err:(document.querySelector('#authError')||{}).textContent})));
 await b.close();
})();
