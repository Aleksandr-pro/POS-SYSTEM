const puppeteer=require('puppeteer');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 const p=await b.newPage(); await p.setViewport({width:1440,height:950});
 p.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await p.goto('http://127.0.0.1:8099/index.html',{waitUntil:'load'});
 await p.evaluate(()=>localStorage.clear());
 await p.reload({waitUntil:'load'}); await sleep(500);
 await p.click('#goRegister'); await sleep(300);
 await p.type('#regName','Тест'); await p.type('#regUser','tst1'); await p.type('#regPass','pass123'); await p.type('#regPass2','pass123');
 await p.evaluate(()=>{const b=document.querySelector('#regTerms');b.checked=true;b.dispatchEvent(new Event('change',{bubbles:true}));});
 await p.click('#regBtn'); await p.waitForSelector('.topbar',{timeout:15000}); await sleep(400);
 await p.evaluate(()=>{logoutUser(); location.hash='#/login';}); await sleep(800);
 await p.evaluate(()=>{document.querySelector('#loginUser').value='tst1';document.querySelector('#loginPass').value='pass123';});
 const r1 = await p.evaluate(()=>{
   const btn=document.querySelector('#loginBtn');
   btn.click();
   return 'clicked';
 });
 await sleep(1200);
 console.log('после JS click:', await p.evaluate(()=>({hash:location.hash, session:!!DB.session, err:(document.querySelector('#authError')||{}).textContent})));
 if (!(await p.evaluate(()=>!!DB.session))) {
   // пробуем submit формы
   await p.evaluate(()=>{document.querySelector('#loginForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));});
   await sleep(1200);
   console.log('после submit:', await p.evaluate(()=>({session:!!DB.session, err:(document.querySelector('#authError')||{}).textContent})));
 }
 await b.close();
})();
