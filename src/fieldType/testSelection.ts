import { bitable } from "@lark-base-open/js-sdk";

export async function testGetSelection() {
  try {
    const selection = await bitable.base.getSelection();
    // console.log("getSelection 返回:", selection);
    return selection;
  } catch (err) {
    console.error("getSelection 报错:", err);
    return null;
  }
}
