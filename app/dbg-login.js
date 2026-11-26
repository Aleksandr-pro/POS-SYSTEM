const puppeteer=require('puppeteer');
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
 const p=await b.newPage(); await p.setViewport({width:1440,height:950});
 p.on('pageerror',e=>console.log('PAGEERROR',e.message));
 p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
 await p.goto('http://127.0.0.1:8099/index.html',{waitUntil:'load'});
 await p.evaluate(()=>{ localStorage.clear(); });
 await p.reload({waitUntil:'load'}); await new Promise(r=>setTimeout(r,400));
 // регистрируем
 await p.click('#goRegister'); await new Promise(r=>setTimeout(r,300));
 await p.type('#regName','Тест'); await p.type('#regUser','tst1'); await p.type('#regPass','pass123'); await p.type('#regPass2','pass123');
 await p.evaluate(()=>{const b=document.querySelector('#regTerms');b.checked=true;b.dispatchEvent(new Event('change',{bubbles:true}));});
 await p.click('#regBtn'); await p.waitForSelector('.topbar',{timeout:15000});
 console.log('зарегистрирован:', await p.evaluate(()=>currentUser().username));
 await p.evaluate(()=>{logoutUser(); location.hash='#/login';});
 await new Promise(r=>setTimeout(r,500));
 await p.reload({waitUntil:'load'}); await new Promise(r=>setTimeout(r,700));
 console.log('сессия:', await p.evaluate(()=>DB.session), 'пользователи:', await p.evaluate(()=>DB.users.map(u=>u.username)));
 console.log('форма:', !!(await p.$('#loginUser')), 'кнопка:', !!(await p.$('#loginBtn')));
 await p.type('#loginUser','tst1'); await p.type('#loginPass','pass123');
 console.log('введено:', await p.evaluate(()=>({u:document.querySelector('#loginUser').value,p:document.querySelector('#loginPass').value})));
 await p.click('#loginBtn');
 await new Promise(r=>setTimeout(r,2000));
 console.log('после клика: hash=', await p.evaluate(()=>location.hash), 'сессия=', await p.evaluate(()=>DB.session), 'err=', await p.evaluate(()=>{const e=document.querySelector('#authError');return e?e.textContent.trim():'нет блока';}));
 await p.screenshot({path:'/tmp/after-login.png'});
 await b.close();
})();
