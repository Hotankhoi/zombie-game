# Cài đặt GitHub cho dự án Zombie Co-op — chạy MỘT LẦN.
# Cách chạy: nhấp đúp file "CAI-DAT-GITHUB.cmd" trong cùng thư mục.
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host ""; Write-Host "LOI: $msg" -ForegroundColor Red; Read-Host "Nhan Enter de dong"; exit 1 }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }

# 1. Kiểm tra công cụ
Step "Kiem tra Node.js va Git"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Chua cai Node.js. Tai tai https://nodejs.org (ban LTS) roi chay lai." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Chua cai Git. Tai tai https://git-scm.com/downloads/win roi chay lai." }

Step "Kiem tra GitHub CLI (gh)"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "Dang cai GitHub CLI bang winget..."
  winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
  RefreshPath
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "Khong cai duoc gh. Tai tai https://cli.github.com roi chay lai." }
}

# 2. Đăng nhập GitHub (phần duy nhất bạn phải tự bấm)
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Step "Dang nhap GitHub — trinh duyet se mo ra, hay bam Authorize"
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { Fail "Dang nhap GitHub that bai." }
}
gh auth setup-git | Out-Null
$owner = (gh api user --jq .login).Trim()
Write-Host "Da dang nhap: $owner"

# 3. Cài thư viện + kiểm tra
Step "Cai thu vien (npm install) — mat 1-2 phut"
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install loi." }
Step "Chay kiem tra (typecheck + lint + test)"
npm run check
if ($LASTEXITCODE -ne 0) { Fail "Kiem tra loi — chup man hinh gui cho Claude." }

# 3b. Dat file GitHub Actions vao dung cho (.github/workflows)
if (Test-Path _github-workflows) {
  New-Item -ItemType Directory -Force -Path .github\workflows | Out-Null
  Copy-Item _github-workflows\*.yml .github\workflows\ -Force
  Remove-Item -Recurse -Force _github-workflows
}

# 4. Git
Step "Tao kho git va commit dau tien"
if (-not (git config user.name))  { git config user.name $owner }
if (-not (git config user.email)) { git config user.email "$owner@users.noreply.github.com" }
if (-not (Test-Path .git)) { git init -b main | Out-Null }
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -F .commit-msg.txt
}

# 5. Tạo repo trên GitHub (public: GitHub Pages miễn phí chỉ dùng được với repo public)
Step "Tao repo GitHub '$owner/zombie-game'"
gh repo view "$owner/zombie-game" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  gh repo create zombie-game --public --source . --remote origin --description "Game 2D zombie co-op online (P2P, mien phi)"
  if ($LASTEXITCODE -ne 0) { Fail "Khong tao duoc repo." }
} elseif (-not (git remote 2>$null | Select-String -SimpleMatch origin)) {
  git remote add origin "https://github.com/$owner/zombie-game.git"
}
git push -u origin main
if ($LASTEXITCODE -ne 0) { Fail "Push loi." }

# 6. Bật GitHub Pages (deploy bằng GitHub Actions)
Step "Bat GitHub Pages"
gh api -X POST "repos/$owner/zombie-game/pages" -f build_type=workflow 2>$null | Out-Null
gh api -X PUT "repos/$owner/zombie-game/pages" -f build_type=workflow 2>$null | Out-Null
gh workflow run deploy.yml 2>$null | Out-Null

# 7. Bảo vệ nhánh main: phải qua Pull Request (chủ repo vẫn có thể bỏ qua khi cần)
Step "Bao ve nhanh main"
$protection = @'
{"required_status_checks":{"strict":false,"contexts":["check"]},"enforce_admins":false,
 "required_pull_request_reviews":{"required_approving_review_count":0},"restrictions":null}
'@
$protection | gh api -X PUT "repos/$owner/zombie-game/branches/main/protection" --input - 2>$null | Out-Null

# 8. Mời bạn cùng làm
Step "Moi ban cung lam (nguoi B)"
$friend = Read-Host "Nhap ten tai khoan GitHub cua ban ban (bo trong neu chua co)"
if ($friend) {
  gh api -X PUT "repos/$owner/zombie-game/collaborators/$friend" -f permission=push | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host "Da gui loi moi cho $friend (ban ay kiem tra email de Accept)." }
}

$pages = "https://$owner.github.io/zombie-game/"
Set-Content -Path .github-info.txt -Value "repo=https://github.com/$owner/zombie-game`npages=$pages" -Encoding UTF8
Step "XONG!"
Write-Host "Repo:  https://github.com/$owner/zombie-game"
Write-Host "Game:  $pages  (doi 1-2 phut de GitHub dua len lan dau)"
Write-Host ""
Write-Host "Quay lai Claude va nhan: 'xong roi'" -ForegroundColor Yellow
Read-Host "Nhan Enter de dong"
