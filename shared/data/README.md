# /shared/data — bảng cân bằng (vùng của B)

Vũ khí, giáp, vật phẩm, zombie, tỉ lệ loot. Chỉ chứa dữ liệu, không chứa logic.

GĐ 3b (A thêm, B đồng ý — B chỉnh số thoải mái, logic nằm ở `shared/sim`):

| File             | Nội dung                                                                        | Logic                    |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------ |
| `survival.ts`    | no / nước / nhiễm trùng / máu tối đa                                            | `shared/sim/survival.ts` |
| `consumables.ts` | băng gạc, bộ sơ cứu, kháng sinh, nước, đồ hộp; độ hiếm × hiệu ứng               | `shared/sim/items.ts`    |
| `guns.ts`        | súng lục, súng trường (sát thương, tầm, tốc độ, băng, nạp, tản, giật, ồn)       | `shared/sim/guns.ts`     |
| `melee.ts`       | thêm `BAT` (gậy), `FISTS` (tay không)                                           | `shared/sim/combat.ts`   |
| `armor.ts`       | mũ/áo/quần: giảm sát thương, giảm nhiễm trùng, độ bền, axit mòn                 | `shared/sim/armor.ts`    |
| `items.ts`       | thêm `helmet`, `vest`, `pants` (loại `armor`) **ở cuối** — mã trên dây = thứ tự | —                        |
| `loot.ts`        | thêm giáp theo khu (`LOOT_VERSION` 2)                                           | `shared/loot/chest.ts`   |
