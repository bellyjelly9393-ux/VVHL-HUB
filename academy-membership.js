(()=>{"use strict";
const prices={monthly:[14.99,39.99,"month"],annual:[149,399,"year"],founding:[9.99,29.99,"month"]};
document.querySelectorAll('input[name="billing"]').forEach(input=>input.addEventListener("change",()=>{
const [standard,premium,period]=prices[input.value];
document.getElementById("standardPrice").innerHTML="$"+standard.toFixed(2)+" <small>/ "+period+"</small>";
document.getElementById("premiumPrice").innerHTML="$"+premium.toFixed(2)+" <small>/ "+period+"</small>";
document.getElementById("billingNote").textContent=input.value==="annual"?"Annual prices are billed yearly: Standard $149 CAD, Premium $399 CAD. Enrollment is not open.":input.value==="founding"?"Planned founding rates apply while continuously subscribed. Member limit and launch date remain to be confirmed; no reservation or payment is taken.":"Monthly prices: Standard $14.99 CAD; Premium $39.99 CAD. Enrollment is not open.";
}));
document.getElementById("coachingTier").addEventListener("change",e=>{
const discount=Number(e.target.value);
document.querySelectorAll("[data-coaching-price]").forEach(cell=>{cell.textContent="$"+(Number(cell.dataset.coachingPrice)*(1-discount)).toFixed(2);});
});
})();