import "vuetify/styles";
import "../../../src/posapp/styles/theme.css";
import "../../../src/posapp/styles/register-tokens.css";
import { createApp, h, ref } from "vue";
import { createPinia } from "pinia";
import vuetify from "../../../src/posapp/plugins/vuetify";
import ActionBand from "../../../src/posapp/components/pos/shell/band/ActionBand.vue";
import CobroTenderPad from "../../../src/posapp/components/pos/payments/cobro/CobroTenderPad.vue";
import { VApp } from "vuetify/components";
(window as any).__ = (value: string) => value;
const amount = ref(150);
const payment = { mode_of_payment: "Cash", type: "Cash", default: 1, amount: 150 };
createApp({ render: () => h(VApp, {}, () => h('main', { style: 'height:100vh;display:flex;flex-direction:column;padding:16px;box-sizing:border-box' }, [
 h('div', { style: 'flex:1;min-height:0;max-width:500px;margin:auto;width:100%;padding:20px' }, [h(CobroTenderPad, {
  payments: [payment], currency: 'MXN', formatCurrency: (n: number) => n.toFixed(2),
  getVisibleDenominations: () => [20,50,100,150,200,300,500,1000],
  bandContextTarget: "[data-band-lane='context']", bandLaneActive: true,
  onSetDenomination: (_: unknown, n: number) => { amount.value = n; },
 })]),
 h(ActionBand, { state: {kind:'change',tone:'positive',value: amount.value-150,labelKey:'Change to give',primaryAction:{id:'sale.collectAndClose',labelKey:'Charge and print'},primaryEnabled:true} })
])) }).use(createPinia()).use(vuetify).mount('#app');
