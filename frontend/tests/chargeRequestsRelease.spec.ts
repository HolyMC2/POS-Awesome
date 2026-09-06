// @vitest-environment jsdom
import { defineComponent, h } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ call: vi.fn(), queue: vi.fn(), outbox: vi.fn(), toast: vi.fn(), load: vi.fn(),
 owner: {} as any, invoice: {} as any, offline: false }));
vi.mock("../src/offline/db", () => ({ isOffline: () => m.offline }));
vi.mock("../src/offline/writeQueue", () => ({ getQueueEntries: m.queue }));
vi.mock("../src/offline/invoiceOutbox", () => ({ getInvoiceOutboxRows: m.outbox }));
vi.mock("../src/offline/queueOwnership", () => ({ currentQueueOwner: () => m.owner }));
vi.mock("../src/offline/shiftTerminal", () => ({ getShiftTerminalContext: () => ({terminal_id: "TERMINAL", terminal_generation: 1, terminal_token: "proof"}) }));
vi.mock("../src/posapp/stores/invoiceStore", () => ({ useInvoiceStore: () => ({ invoiceDoc: m.invoice, triggerLoadInvoice: m.load }) }));
vi.mock("../src/posapp/stores/uiStore", () => ({ useUIStore: () => ({ posOpeningShift: { name: "SHIFT" } }) }));
vi.mock("../src/posapp/stores/toastStore", () => ({ useToastStore: () => ({ show: m.toast }) }));
vi.mock("../src/posapp/composables/core/useDialogFullscreen", () => ({ useDialogFullscreen: () => ({ dialogProps: {} }) }));
vi.mock("../src/posapp/composables/pos/shell/useHostedSheet", () => ({ useHostedSheet: () => ({ isHosted: false }) }));
import Dialog from "../src/posapp/components/navbar/ChargeRequestsDialog.vue";
const Box = defineComponent({ setup: (_, { slots }) => () => h("div", [slots.default?.(), slots.append?.()]) });
const Btn = defineComponent({ props: ["disabled", "loading"], setup: (p, {slots}) => () => h("button", {disabled:p.disabled || p.loading}, slots.default?.()) });
const wrappers: VueWrapper[] = [];
const row = { name: "PCR-1", invoice: "INV-1", can_release: true, amount_total: 10 };
const mutations = () => m.call.mock.calls.filter(([args]) => args.method.includes("release_charge"));
async function open() {
 const components: Record<string, any> = {VBtn:Btn};
 for(const name of ["VDialog", "VCard", "VCardTitle", "VCardText", "VCardActions", "VAlert", "VList", "VListItem", "VListItemTitle", "VListItemSubtitle", "VIcon", "VSpacer", "VProgressCircular"])components[name]=Box;
 const w = mount(Dialog, { props: { posProfile: { name: "COUNTER" } }, global: { components } }); wrappers.push(w);
 await w.setProps({modelValue:true}); await flushPromises(); return w;
}
async function release(w: VueWrapper) {
 await w.get('[data-testid="release-charge-draft"]').trigger("click");
 const buttons = w.get('[data-testid="release-charge-confirmation"]').findAll("button");
 await buttons[1]!.trigger("click"); await flushPromises();
}
beforeEach(()=>{
 vi.clearAllMocks(); m.offline=false; m.owner={queue_user:"cashier",queue_profile:"COUNTER"}; m.invoice={};
 m.queue.mockResolvedValue([]); m.outbox.mockResolvedValue([]);
 m.call.mockImplementation(async ({method})=>({message:method.includes("get_open_charge")?[row]:{released:true,invoice:"INV-1"}}));
 (window as any).__=(x:string)=>x; (window as any).frappe={call:m.call};
});
afterEach(()=>wrappers.splice(0).forEach(w=>w.unmount()));
describe("charge draft release",()=>{
 it("requires explicit confirmation and sends the exact owned pin and terminal proof",async()=>{
  const w=await open(); expect(mutations()).toHaveLength(0); await release(w);
  expect(mutations()).toHaveLength(1); expect(mutations()[0]![0].args).toEqual({name:"PCR-1",invoice_name:"INV-1",pos_profile:"COUNTER",pos_opening_shift:"SHIFT",terminal_id:"TERMINAL",terminal_generation:1,terminal_token:"proof"});
  expect(m.load).not.toHaveBeenCalled(); expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({title:"Draft released"}));
 });
 it.each(["offline","queue","outbox","tender"])("keeps %s intent untouched and makes no release call",async kind=>{
  const w=await open();
  if(kind==="offline")m.offline=true;
  if(kind==="queue")m.queue.mockResolvedValue([{client_request_id:"ORIGINAL"}]);
  if(kind==="outbox")m.outbox.mockResolvedValue([{status:"acknowledged",server_verified:false}]);
  if(kind==="tender")m.invoice={name:"INV-1",payments:[{amount:10}]};
  await release(w); expect(mutations()).toHaveLength(0); expect(m.load).not.toHaveBeenCalled();
 });
 it("rejects owner changes while reading saved work",async()=>{
  const w=await open(); m.queue.mockImplementation(async()=>{m.owner={queue_user:"other",queue_profile:"COUNTER"};return []});
  await release(w); expect(mutations()).toHaveLength(0); expect(w.text()).toContain("cashier or register changed");
 });
 it("does not paint stale server rows after a cashier switch",async()=>{
  let done!:(v:any)=>void; m.call.mockImplementation(()=>new Promise(resolve=>{done=resolve}));
  const w=await open();m.owner={queue_user:"other",queue_profile:"COUNTER"};done({message:[row]});await flushPromises();
  expect(w.find('[data-testid="release-charge-draft"]').exists()).toBe(false);expect(w.text()).not.toContain("PCR-1");
 });
 it("does not claim success after an uncertain response",async()=>{
  const w=await open();m.call.mockResolvedValue({message:{}});await release(w);
  expect(w.text()).toContain("Release could not be verified");expect(m.toast).not.toHaveBeenCalled();
 });
});
