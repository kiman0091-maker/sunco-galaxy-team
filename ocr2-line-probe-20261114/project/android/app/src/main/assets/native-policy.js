(function(root){
 const contract=v=>/^(?:[A-Z][0-9]{4}|[A-Z]{2}[0-9]{3})[A-Z][A-Z0-9][0-9]{6}$/.test(v||'');
 const vin=v=>/^[A-HJ-NPR-Z0-9]{11}[0-9]{6}$/.test(v||'');
 function complete(r){return contract(r.contract)&&vin(r.vin)}
 function merge(local,remote){
  const rapid=['upper-band-number-anchors','validated-cell-legacy','offline-three-cells'].includes(remote.strategy);
  const conflict=['contract','vin'].some(k=>local[k]&&remote[k]&&local[k]!==remote[k]);
  const result={contract:local.contract||'',vin:local.vin||'',customerName:local.customerName||remote.customerName||'',requiresReview:true};
  if(!rapid||conflict){result.contract='';result.vin='';result.error=conflict?'휴대폰과 서버의 번호가 달라 원본 확인이 필요합니다.':'RapidOCR 재검사 결과를 확인하지 못했습니다.';return result;}
  for(const key of ['contract','vin'])if(!result[key])result[key]=remote[key]||'';
  if(!complete(result)){result.contract='';result.vin='';result.error='번호가 불명확하여 자동 인증하지 않았습니다.';}
  return result;
 }
 const policy={complete,merge};if(typeof module!=='undefined')module.exports=policy;else root.SuncoNumberPolicy=policy;
})(globalThis);
