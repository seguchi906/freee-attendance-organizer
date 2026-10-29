import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3001';
const paths = ['dashboard','vacation-summaries','paid-leave-compliance','session','report-data','overtime-summaries','imports','imports/validate','employees/test'];
const results = [];
for (const path of paths) {
  for (const origin of ['http://localhost:5173','https://n-app-portal.netlify.app','https://untrusted.example']) {
    const response = await fetch(`${base}/api/${path}`, {method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});
    const body = await response.text();
    assert.equal(response.status,204); assert.equal(body,'');
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    assert.equal(response.headers.get('access-control-allow-credentials'),null);
    assert.ok(response.headers.get('allow')?.includes('OPTIONS'));
    results.push({path,origin,status:response.status,bodyBytes:body.length,allow:response.headers.get('allow'),corsPermission:false});
  }
  for (const method of ['GET','HEAD','POST','PATCH','PUT','DELETE']) {
    const response = await fetch(`${base}/api/${path}`, {method,headers:{Authorization:'Bearer synthetic-invalid-token'}});
    assert.ok([401,405].includes(response.status), `${path} ${method}: ${response.status}`);
  }
}
console.log(JSON.stringify({optionsCases:results.length,invalidBusinessMethodCases:paths.length*6,results},null,2));
