# SOL Carton Size Helper

A lightweight front-end plugin for Feishu Bitable that helps SOL teams calculate optimal inner and master carton dimensions, buffers, and weights directly from product records.

## Features
- Works inside Feishu Bitable and automatically picks up the active table/view context.
- Calculates best-fit arrangements for inner and master cartons while respecting configurable buffer sizes.
- Converts between centimetres and inches, estimates package weight, and writes results back to the sheet.
- Validates required numeric fields and surfaces issues through inline logs and toast messages.
- Provides a "设置字段类型" toolbox so you can quickly convert Bitable columns to the expected field types (文本、整数、小数、货币、单选、人员、公式、日期)。
- Offers one-click buttons to generate preset views（尺寸、三段分析、Spec、关税视图），免去手动挑选列的步骤。
- Zero-backend by default, but ready to call an external service via `src/config/config.ts` when needed.

## Prerequisites
- Node.js 18 or later.
- npm 9+ (bundled with recent Node releases).
- Access to a Feishu (Lark) Bitable base where this plugin will be embedded.

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. (Optional) Update `src/config/config.ts` if you need to call a backend service. Leaving the URL empty keeps everything client-side.
3. Start the dev server:
   ```bash
   npm run dev
   ```
   Vite will print a local URL. Use it as the plugin URL when configuring your Feishu Bitable development instance.

## Required Bitable Fields
The plugin looks up fields by _display name_. Ensure the active table contains the following numeric columns (type: number) and that their names match exactly:

| Key | Display name | Purpose |
| --- | --- | --- |
| `itemHeight` | `Item Height (inch)` | Product height in inches. |
| `itemWidth` | `Item Width (inch)` | Product width in inches. |
| `itemDepth` | `Item Depth (inch)` | Product depth in inches. |
| `itemWeight` | `Item Weight ( g )` | Product weight in grams. |
| `innerQty` | `Inner Qty` | Quantity per inner carton. |
| `masterQty` | `Master Qty` | Quantity per master carton. |
| `innerWidth` | `Inner Width (inch)` | Calculated inner carton width. |
| `innerDepth` | `Inner Depth (inch)` | Calculated inner carton depth. |
| `innerHeight` | `Inner Height (inch)` | Calculated inner carton height. |
| `innerWeight` | `Inner Weight (lbs)` | Calculated gross weight for the inner carton. |
| `masterWidth` | `Master Width (inch)` | Calculated master carton width. |
| `masterDepth` | `Master Depth (inch)` | Calculated master carton depth. |
| `masterHeight` | `Master Height (inch)` | Calculated master carton height. |
| `netWeight` | `N.W. (kg)` | Calculated net weight for the master carton. |

> Tip: If your sheet must use different labels, adjust `FIELD_KEYS` in `src/config/fields.ts` to keep the plugin in sync.

## Usage inside Feishu Bitable
1. Open the Bitable base containing the fields above.
2. Select the view you want the plugin to act on.
3. Launch the plugin panel (either via the development URL during testing or the hosted build in production).
4. In the **计算箱型** section，设置缓冲、材质、Overlap 等参数，可勾选“计算当前视图全部记录”或只处理已选中记录。
5. 点击 **开始计算** 更新箱型尺寸并查看日志输出。
6. 在 **设置字段类型** 区域，按照需要点击按钮快速调整当前选中的列：
   - `文本` / `整数` / `小数 0.00`：支持与公式冲突时选择“保留公式 / 彻底转换 / 取消”。
   - `货币`：一次选择币种（默认 USD）和显示格式。
   - `单选`：自动收集现有单元格内容生成选项并写回，保留原数据。
   - `人员`：转为单人选择字段。
   - `公式`：转换为公式字段（默认空公式，若原本是公式则提示不重复设置）。
   - `日期`：直接转换为短日期字段。
   - `附件`：直接转换为附件字段（遇到公式字段也会强制转换）。
7. 在 **一键建立视图** 区域，选择需要的按钮（价格、尺寸、关税、Spec），系统会自动创建并显示相应字段；若同名视图已存在则会提示跳过。若希望统一筛选/分组/排序，可点击 `一键分组/排序/筛选` 同步到上述视图。

## Development Workflow
- `npm run dev` – Start Vite with hot module replacement.
- `npm run build` – Type-check with `tsc` and output static assets to `dist/`.
- `npm run preview` – Serve the production build locally for smoke-testing.

During development, keep the plugin console open in Feishu to monitor log output from the calculation process.

## Building & Deployment
1. Run `npm run build` to generate the production bundle in `dist/`.
2. Host the contents of `dist/` on a static server reachable by Feishu (for example, upload to the Feishu Developer Platform as a custom app asset).
3. Update the plugin configuration in Feishu Bitable to point to the hosted URL.
4. Publish the plugin once you have validated it in the target workspace.

## Project Structure
```text
src/
├─ config/        # Feishu field mapping & runtime config stubs
├─ core/          # Calculation logic and context loading helpers
├─ ui/            # jQuery-powered UI orchestration
├─ utils/         # Shared utilities (logging, parsing, maths)
├─ index.scss     # UI styling
└─ index.ts       # Entry point that wires everything together
```

## Troubleshooting
- **Missing field warnings**: The banner shows which columns are not found in the active view—rename the columns or update `FIELD_KEYS`.
- **No records processed**: Ensure you selected rows or enabled “计算当前视图全部记录”, and that the current view is not filtered to zero rows.
- **Weight not calculated**: A product weight is required to estimate inner/master weights. Verify `Item Weight ( g )` is filled and numeric.
- **Feishu toast errors**: The plugin degrades gracefully if toast notifications fail, but you can inspect the browser console for details.

## Tech Stack
- Vite + TypeScript
- jQuery for DOM handling inside the Feishu webview
- Feishu Bitable JavaScript SDK (`@lark-base-open/js-sdk`)
- Sass for styling

## License
Distributed under the [ISC](LICENSE) license.
