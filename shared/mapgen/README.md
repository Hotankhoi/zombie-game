# /shared/mapgen — sinh bản đồ từ seed (vùng của B)

Việc 1b. Dùng `Rng` trong `shared/util/rng.ts` (`new Rng(seed).fork('chunk:x,y')` cho mỗi chunk)
để cùng seed luôn ra cùng bản đồ trên mọi máy. Không import Phaser ở đây — chỉ sinh dữ liệu;
phần vẽ nằm ở `/client`.
