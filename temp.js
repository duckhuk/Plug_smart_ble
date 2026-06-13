
    if (sessionStorage.getItem("ble_auth") !== "1") {
      location.replace("/login.html");
    }
  


    function logout() {
      sessionStorage.removeItem("ble_auth");
      sessionStorage.removeItem("ble_user");
      location.replace("/login.html");
    }

    const storedUser = sessionStorage.getItem("ble_user") || "admin";
    document.getElementById("user-name").textContent =
      storedUser.charAt(0).toUpperCase() + storedUser.slice(1);
    document.getElementById("user-avatar").textContent =
      storedUser.slice(0, 2).toUpperCase();

    function switchPage(pageName) {
      if (pageName === 'gateway') {
        setTimeout(renderGateways, 100);
      }
      const pages = document.querySelectorAll('.page-section');
      pages.forEach(page => page.classList.remove('active'));

      const navItems = document.querySelectorAll('.nav-item');
      navItems.forEach(item => item.classList.remove('active'));

      const selectedPage = document.getElementById(`page-${pageName}`);
      if (selectedPage) {
        selectedPage.classList.add('active');
      }

      if (typeof event !== 'undefined' && event && event.target && event.target.closest('.nav-item')) {
        event.target.closest('.nav-item').classList.add('active');
      }

      const topbarTitle = document.getElementById('topbar-title');
      const topbarBreadcrumb = document.getElementById('topbar-breadcrumb');

      switch (pageName) {
        case 'dashboard':
          topbarTitle.textContent = 'Quản lý vị trí';
          topbarBreadcrumb.textContent = 'Vị trí';
          break;
        case 'devices':
          topbarTitle.textContent = 'Quản lý thiết bị';
          topbarBreadcrumb.textContent = 'Danh sách thiết bị';
          break;

        case 'gateway':
          topbarTitle.textContent = 'Quản lý Gateway';
          topbarBreadcrumb.textContent = 'Gateway';
          break;
        case 'reports':
          topbarTitle.textContent = 'Lịch sử & Báo cáo';
          topbarBreadcrumb.textContent = 'Báo cáo';
          break;
        case 'system':
          topbarTitle.textContent = 'Quản lý hệ thống';
          topbarBreadcrumb.textContent = 'Quản lý tài khoản';
          break;
        default:
          topbarTitle.textContent = 'Quản lý vị trí';
          topbarBreadcrumb.textContent = 'Vị trí';
      }
    }

    /* ── DOM refs ── */
    const root = document.getElementById("root");
    const statTotal = document.getElementById("stat-total");
    const statOnline = document.getElementById("stat-online");
    const statOffline = document.getElementById("stat-offline");
    const connBadge = document.getElementById("conn-badge");
    const connDot = document.getElementById("conn-dot");
    const connText = document.getElementById("conn-text");
    const searchInput = document.getElementById("search-input");
    const statusFilter = document.getElementById("status-filter");
    const roomFilter = document.getElementById("room-filter");
    const liveTime = document.getElementById("live-time");
    const gatewayRoot = document.getElementById("gateway-root");
    const logConsole = document.getElementById("log-console");
    const noiseStats = document.getElementById("noise-stats");

    // Device page refs
    const devSearchInput = document.getElementById("dev-search-input");
    const devStatusFilter = document.getElementById("dev-status-filter");
    const devRoomFilter = document.getElementById("dev-room-filter");
    const deviceList = document.getElementById("device-list");

    let devices = {};
    let gateways = {};
    let lastMgmtKey = "";
    let lastMgmtAt = 0;
    let selectedDeviceId = "";
    const drafts = { add: { mac: "", name: "" }, remove: { mac: "", name: "" } };

    /* ── Live Clock ── */
    function updateLiveTime() {
      const now = new Date();
      const d = now.toLocaleDateString('vi-VN');
      const t = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      liveTime.textContent = `${d}  ${t}`;
    }
    updateLiveTime();
    setInterval(updateLiveTime, 1000);

    /* ── Connection ── */
    function setConnected(isConn) {
      if (isConn) {
        connBadge.className = 'conn-badge connected';
        connDot.style.background = 'var(--success)';
        connText.innerText = 'Connected';
      } else {
        connBadge.className = 'conn-badge disconnected';
        connDot.style.background = 'var(--danger)';
        connText.innerText = 'Disconnected';
      }
    }

    /* ── Room Filter ── */
    function updateRoomFilter() {
      const rooms = new Set();
      for (const id of Object.keys(devices)) {
        const r = devices[id]?.currentRoom;
        if (r) rooms.add(r);
      }
      const cur = roomFilter.value;
      roomFilter.innerHTML = '<option value="all">Tất cả vị trí</option>';
      for (const room of Array.from(rooms).sort()) {
        const opt = document.createElement("option");
        opt.value = room; opt.textContent = room;
        roomFilter.appendChild(opt);
      }
      if (Array.from(rooms).includes(cur)) roomFilter.value = cur;
    }

    /* Device Room Filter - for devices page */
    function updateDeviceRoomFilter() {
      if (!devRoomFilter) return;
      const rooms = new Set();
      for (const id of Object.keys(devices)) {
        const r = devices[id]?.meta?.room;
        if (r) rooms.add(r);
      }
      const cur = devRoomFilter.value;
      devRoomFilter.innerHTML = '<option value="all">Tất cả vị trí</option><option value="untagged">Chưa gắn tag</option>';
      for (const room of Array.from(rooms).sort()) {
        const opt = document.createElement("option");
        opt.value = room; opt.textContent = room;
        devRoomFilter.appendChild(opt);
      }
      if (cur === 'all' || cur === 'untagged' || Array.from(rooms).includes(cur)) {
        devRoomFilter.value = cur;
      }
    }

    /* ── Helpers ── */
    function formatDateOnly(ms) {
      return new Date(ms).toLocaleDateString('vi-VN');
    }

    function formatTimeOnly(ms) {
      return new Date(ms).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }

    function hashToNumber(text) {
      let hash = 0;
      for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash);
    }

    function buildEnergyPath(points, width, height) {
      if (!points.length) return { line: '', area: '' };
      const step = width / (points.length - 1);
      const maxVal = Math.max(...points);
      const minVal = Math.min(...points);
      const padding = height * 0.1;
      const innerHeight = height - padding * 2;
      const range = Math.max(1, maxVal - minVal);

      const scaled = points.map((v, i) => {
        const x = Number((i * step).toFixed(1));
        const y = Number((padding + innerHeight - ((v - minVal) / range) * innerHeight).toFixed(1));
        return { x, y };
      });

      let line = `M${scaled[0].x},${scaled[0].y}`;
      for (let i = 0; i < scaled.length - 1; i += 1) {
        const p1 = scaled[i];
        const p2 = scaled[i + 1];
        const cpX = Number((p1.x + (p2.x - p1.x) / 2).toFixed(1));
        line += ` C${cpX},${p1.y} ${cpX},${p2.y} ${p2.x},${p2.y}`;
      }

      const area = `${line} L${width},${height} L0,${height} Z`;
      return { line, area };
    }

    function getDeviceEnergySample(mac) {
      const dev = devices[mac];
      let actualPower = 0;
      let hasRealPower = false;

      if (dev && dev.meta && typeof dev.meta.power === "number") {
        actualPower = dev.meta.power;
        hasRealPower = true;
      }

      const base = hasRealPower ? actualPower : (40 + (hashToNumber(mac) % 180));

      const points = Array.from({ length: 24 }, (_, i) => {
        const wave = Math.sin((i / 24) * Math.PI * 2) * (base > 50 ? 12 : 2);
        const jitter = (hashToNumber(`${mac}-${i}`) % 10) - 5;
        let p = Math.max(0, base + wave + jitter);

        if (i === 23 && hasRealPower) {
          p = actualPower;
        }
        return p;
      });

      return {
        watt: hasRealPower ? actualPower.toFixed(1) : (base + (hashToNumber(mac) % 15) / 10).toFixed(1),
        points,
      };
    }

    /* ── Render ── */
    function render() {
      const ids = Object.keys(devices).sort();
      const onlineIds = ids.filter(id => devices[id].meta?.status === 1);
      const offlineIds = ids.filter(id => devices[id].meta?.status !== 1);

      statTotal.textContent = ids.length;
      statOnline.textContent = onlineIds.length;
      statOffline.textContent = offlineIds.length;
      updateRoomFilter();

      const query = searchInput.value.trim().toLowerCase();
      const statusValue = statusFilter.value;
      const roomValue = roomFilter.value;

      if (!ids.length) {
        root.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
              </svg>
            </div>
            <h3>Chưa có thiết bị</h3>
            <p>Nhấn "Thêm mới" để thêm thiết bị theo dõi.</p>
          </div>`;
        return;
      }

      const rows = [];
      if (selectedDeviceId && !devices[selectedDeviceId]) {
        selectedDeviceId = '';
      }
      for (const deviceId of ids) {
        const d = devices[deviceId];
        const current = d.currentRoom;
        const meta = d.meta || {};
        const name = meta.name || (meta.id != null ? `Thiết bị ${meta.id}` : deviceId);
        const status = meta.status === 1 ? 'on' : 'off';

        if (query) {
          const target = `${deviceId} ${name}`.toLowerCase();
          if (!target.includes(query)) continue;
        }
        if (statusValue !== 'all' && statusValue !== status) continue;
        if (roomValue !== 'all' && roomValue !== current) continue;

        const locationHTML = current
          ? `<span class="location-tag">${current}</span>`
          : `<span class="location-unknown">— Không xác định</span>`;

        const statusHTML = status === 'on'
          ? `<span class="status-pill status-on">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
                 <path d="M18.364 5.636a9 9 0 1 1-12.728 0"/><line x1="12" y1="2" x2="12" y2="12"/>
               </svg>
               Hoạt động
             </span>`
          : `<span class="status-pill status-off">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
                 <circle cx="12" cy="12" r="9"/>
                 <line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
               </svg>
               Tắt
             </span>`;

        rows.push(`
          <tr class="device-row${selectedDeviceId === deviceId ? ' selected' : ''}">
            <td>
              <div class="device-cell">
                <div class="device-info">
                  <div class="device-name">${name}</div>
                  <div class="device-mac">${deviceId}</div>
                </div>
              </div>
            </td>
            <td>${locationHTML}</td>
            <td>${statusHTML}</td>
            <td><span class="time-ago">${formatDateOnly(d.updatedAt || Date.now())}</span></td>
            <td class="action-cell">
              <button class="row-action btn-view" type="button" title="Xem thông tin" aria-label="Xem thông tin"
                onclick="selectDevice('${deviceId}'); event.stopPropagation();">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button class="row-action btn-delete" type="button" title="Xoá thiết bị" aria-label="Xoá thiết bị"
                onclick="openRemoveFor('${deviceId}'); event.stopPropagation();">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </td>
          </tr>
        `);
      }

      let scrollPos = 0;
      const scrollEl = root.querySelector('.table-scroll');
      if (scrollEl) scrollPos = scrollEl.scrollTop;

      root.innerHTML = `
        <div class="table-scroll">
          <table class="device-table">
            <thead>
              <tr>
                <th>Thiết bị</th>
                <th>Vị trí</th>
                <th>Trạng thái</th>
                <th>Cập nhật</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.length
          ? rows.join('')
          : '<tr><td class="table-empty" colspan="5">Không tìm thấy thiết bị phù hợp</td></tr>'}
            </tbody>
          </table>
        </div>`;

      const newScrollEl = root.querySelector('.table-scroll');
      if (newScrollEl && scrollPos > 0) newScrollEl.scrollTop = scrollPos;

      updateSysStats();
    }
    /* ── Gateways Render ── */
    function renderGateways() {
      if (!gatewayRoot) return;
      const ids = Object.keys(gateways).sort();
      if (!ids.length) {
        gatewayRoot.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 7V5a5 5 0 0 1 10 0v2" /></svg></div>
            <h3>Danh sách Gateway</h3>
            <p>Các Gateway đang hoạt động.</p>
          </div>`;
        return;
      }

      const rows = ids.map(id => {
        const gw = gateways[id];
        const isOnline = (Date.now() - (gw.lastSeen || 0)) < 15000;
        const statusHTML = isOnline
          ? `<span class="status-pill status-on"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.364 5.636a9 9 0 1 1-12.728 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg> Online</span>`
          : `<span class="status-pill status-off"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg> Offline</span>`;

        return `
          <tr>
            <td><strong>${id}</strong></td>
            <td><code style="font-size:0.75rem;">${gw.ip || '192.168.1.10'}</code></td>
            <td>${statusHTML}</td>
            <td><span class="location-tag" style="background:#fff3e0; color:#e65100;">📶 -${40 + Math.floor(Math.random() * 30)} dBm</span></td>
            <td style="text-align:right;">
              <button class="btn-icon" onclick="openGwConfig('${id}')" title="Cấu hình"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
              <button class="btn-icon danger" onclick="rebootGateway('${id}')" title="Reboot"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></button>
            </td>
          </tr>`;
      });

      let gwScrollPos = 0;
      const gwScrollEl = gatewayRoot.querySelector('.table-scroll');
      if (gwScrollEl) gwScrollPos = gwScrollEl.scrollTop;

      gatewayRoot.innerHTML = `
        <div class="table-scroll">
          <table class="user-table">
            <thead>
              <tr>
                <th>Tên Gateway</th>
                <th>Địa chỉ IP</th>
                <th>Trạng thái</th>
                <th>WiFi RSSI</th>
                <th style="text-align:right;">Hành động</th>
              </tr>
            </thead>
            <tbody>
              ${rows.join('')}
            </tbody>
          </table>
        </div>`;

      const newGwScrollEl = gatewayRoot.querySelector('.table-scroll');
      if (newGwScrollEl && gwScrollPos > 0) newGwScrollEl.scrollTop = gwScrollPos;
    }

    /* ── Render Devices Page ── */
    function renderDevices() {
      if (!deviceList) return;

      const ids = Object.keys(devices).sort();
      const onlineIds = ids.filter(id => devices[id].meta?.status === 1);
      const offlineIds = ids.filter(id => devices[id].meta?.status !== 1);

      // Toggle visibility between center and table
      const deviceManagementCenter = document.querySelector('.device-management-center');
      const deviceTableContainer = document.getElementById('device-table-container');

      if (!ids.length) {
        if (deviceManagementCenter) deviceManagementCenter.style.display = 'flex';
        if (deviceTableContainer) deviceTableContainer.style.display = 'none';
        return;
      }

      // Show table, hide center
      if (deviceManagementCenter) deviceManagementCenter.style.display = 'none';
      if (deviceTableContainer) deviceTableContainer.style.display = 'block';

      // Update room filter options
      updateDeviceRoomFilter();

      const query = devSearchInput?.value.trim().toLowerCase() || '';
      const statusValue = devStatusFilter?.value || 'all';
      const roomValue = devRoomFilter?.value || 'all';

      const rows = ids.map(deviceId => {
        const dev = devices[deviceId];
        const meta = dev?.meta || {};
        const name = meta.name || (meta.id != null ? `Thiết bị ${meta.id}` : deviceId);
        const room = meta.room || 'Chưa xác định';
        const lastUpdate = dev?.updatedAt || Date.now();
        const timeAgo = Math.floor((Date.now() - lastUpdate) / 1000);
        let timeText;
        if (timeAgo < 60) timeText = 'Vừa cập nhật';
        else if (timeAgo < 3600) timeText = Math.floor(timeAgo / 60) + ' phút trước';
        else if (timeAgo < 86400) timeText = Math.floor(timeAgo / 3600) + ' giờ trước';
        else timeText = Math.floor(timeAgo / 86400) + ' ngày trước';

        const isOnline = meta.status === 1;
        const statusHTML = isOnline
          ? `<span class="status-pill status-on"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1"/></svg> Online</span>`
          : `<span class="status-pill status-off"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg> Offline</span>`;

        // Filters
        const matchSearch = !query || name.toLowerCase().includes(query) || deviceId.toLowerCase().includes(query);
        const matchStatus = statusValue === 'all' || (statusValue === 'online' && isOnline) || (statusValue === 'offline' && !isOnline);
        const matchRoom = roomValue === 'all' ||
          (roomValue === 'untagged' && !meta.room) ||
          (meta.room === roomValue);
        if (!matchSearch || !matchStatus || !matchRoom) return '';

        return `
          <tr class="device-row" onclick="selectDevice('${deviceId}')">
            <td>
              <div class="device-cell">
                <div class="device-info">
                  <div class="device-name">${name}</div>
                  <div class="device-mac">${deviceId}</div>
                </div>
              </div>
            </td>
            <td><code style="font-size:0.75rem; background:#f3f4f6; padding:2px 6px; border-radius:4px;">${deviceId}</code></td>
            <td style="text-align:right;">
              <button class="row-action" onclick="selectDevice('${deviceId}'); event.stopPropagation();" title="Chi tiết">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><path d="M20 12c-1.5 2.5-5 4-8 4s-6.5-1.5-8-4c1.5-2.5 5-4 8-4s6.5 1.5 8 4"/></svg>
              </button>
              <button class="row-action" onclick="openRemoveFor('${deviceId}'); event.stopPropagation();" title="Xóa" style="color:#dc2626;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </td>
          </tr>`;
      }).filter(r => r);

      deviceList.innerHTML = rows.length ? rows.join('') : `<tr><td colspan="3"><div class="table-empty"><p>Không tìm thấy thiết bị phù hợp với bộ lọc</p></div></td></tr>`;
    }
    function handleChartHover(e, deviceId, points) {
      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;

      const width = rect.width;
      const step = width / 23;
      let index = Math.round(x / step);
      if (index < 0) index = 0;
      if (index > 23) index = 23;

      const snapX = index * step;
      const val = points[index];

      const hs = String(index).padStart(2, '0');
      const timeStr = `${hs}:00`;

      const safeId = deviceId.replace(/:/g, '');
      const tooltip = document.getElementById(`tooltip-${safeId}`);
      const line = document.getElementById(`hover-line-${safeId}`);
      if (!tooltip || !line) return;

      tooltip.style.opacity = '1';
      tooltip.style.left = `${snapX}px`;
      tooltip.innerHTML = `${val} <span>W</span> <div style="font-size:0.65rem;font-weight:400;color:#94a3b8;margin-top:2px;">${timeStr}</div>`;

      line.style.opacity = '1';
      line.style.left = `${snapX}px`;
    }

    function hideChartHover(deviceId) {
      const safeId = deviceId.replace(/:/g, '');
      const tooltip = document.getElementById(`tooltip-${safeId}`);
      const line = document.getElementById(`hover-line-${safeId}`);
      if (tooltip) tooltip.style.opacity = '0';
      if (line) line.style.opacity = '0';
    }




    function addLog(msg, type = 'info') {
      if (!logConsole) return;
      const t = new Date().toLocaleTimeString('en-GB');
      const line = document.createElement('div');
      line.className = `log-line ${type}`;
      line.innerHTML = `<span style="opacity:0.6; margin-right:8px;">[${t}]</span> ${msg}`;
      logConsole.appendChild(line);
      logConsole.scrollTop = logConsole.scrollHeight;
      if (logConsole.children.length > 50) logConsole.removeChild(logConsole.firstChild);
    }

    /* ── Modals ── */
    function openModal(id) {
      const el = document.getElementById(id);
      el.style.display = 'flex';
      if (id === 'modal-add') {
        document.getElementById('add-mac').value = drafts.add.mac;
        document.getElementById('add-name').value = drafts.add.name;
      }
      if (id === 'modal-remove') {
        document.getElementById('rm-mac').value = drafts.remove.mac;
        document.getElementById('rm-name').value = drafts.remove.name;
      }
    }

    function closeModal(id) {
      if (id === 'modal-add') {
        drafts.add.mac = document.getElementById('add-mac').value;
        drafts.add.name = document.getElementById('add-name').value;
      }
      if (id === 'modal-remove') {
        drafts.remove.mac = document.getElementById('rm-mac').value;
        drafts.remove.name = document.getElementById('rm-name').value;
      }
      document.getElementById(id).style.display = 'none';
    }

    function openRemoveFor(mac) {
      const dev = devices[mac];
      const meta = dev ? (dev.meta || {}) : {};
      const name = meta.name || (meta.id != null ? `Thiết bị ${meta.id}` : mac);
      document.getElementById('rm-mac').value = mac;
      document.getElementById('rm-name').value = name;
      drafts.remove.mac = mac;
      drafts.remove.name = name;
      openModal('modal-remove');
    }

    function selectDevice(deviceId) {
      selectedDeviceId = deviceId;
      openDetailFor(deviceId);
      render();
    }

    function openDetailFor(deviceId) {
      const dev = devices[deviceId];
      if (!dev) return;
      const meta = dev.meta || {};
      const lastAt = dev.updatedAt || Date.now();
      const label = meta.name || (meta.id != null ? `Thiết bị ${meta.id}` : deviceId);
      const statusText = meta.status === 1 ? 'Hoạt động' : 'Tắt';

      const sample = getDeviceEnergySample(deviceId);
      const chart = buildEnergyPath(sample.points, 640, 180);
      const pointsJson = JSON.stringify(sample.points.map(p => Math.round(p)));
      const safeId = deviceId.replace(/:/g, '');

      const detailBody = document.getElementById('detail-body');
      if (!detailBody) return;
      detailBody.innerHTML = `
        <div class="detail-panel" style="margin-bottom: 12px;">
          <div class="detail-grid">
            <div><span>Tên</span><strong>${label}</strong></div>
            <div><span>MAC</span><strong>${deviceId}</strong></div>
            <div><span>Vị trí</span><strong>${dev.currentRoom || '—'}</strong></div>
            <div><span>Trạng thái</span><strong>${statusText}</strong></div>
            <div><span>Thời gian cập nhật</span><strong>${formatTimeOnly(lastAt)}</strong></div>
            <div><span>Ngày cập nhật</span><strong>${formatDateOnly(lastAt)}</strong></div>
          </div>
        </div>
        <div class="energy-modal-card" style="margin-bottom: 12px; padding: 10px 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
          <div class="energy-modal-label" style="font-size: 0.8rem; color: #64748b; font-weight: 600; text-transform: none;">Công suất tiêu thụ</div>
          <div class="energy-modal-value" style="font-size: 1.25rem; font-weight: 700; color: #2563eb;">
            <span>${sample.watt}</span>
            <span class="energy-modal-unit" style="font-size: 0.9rem; color: #64748b; margin-left: 4px;">W</span>
          </div>
        </div>
        <div class="energy-modal-chart">
          <div class="energy-modal-chart-head" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 600; font-size: 0.9rem; color: #1e293b;">
            <div>Tiêu thụ điện năng 24h</div>
            <div class="energy-modal-unit-text" style="font-size: 0.75rem; color: #64748b;">Đơn vị: W</div>
          </div>
          <div class="energy-modal-chart-wrap" style="position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; background: #f8fafc;" onmousemove="handleChartHover(event, '${deviceId}', ${pointsJson})" onmouseleave="hideChartHover('${deviceId}')">
            <div id="hover-line-${safeId}" class="en-chart-hover-line" style="opacity: 0; position: absolute; left: 0; top: 0; bottom: 0; width: 1px; background: rgba(37,99,235,0.4); pointer-events: none; z-index: 10;"></div>
            <div id="tooltip-${safeId}" class="en-tooltip" style="opacity: 0; position: absolute; left: 0; top: 10px; transform: translateX(-50%); background: #1e293b; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; pointer-events: none; z-index: 20; white-space: nowrap;"></div>
            <svg viewBox="0 0 640 140" class="energy-modal-svg" preserveAspectRatio="none" style="width: 100%; height: 140px; display: block; border-bottom: 1px solid #e2e8f0;">
              <defs>
                <linearGradient id="energyFill-${safeId}" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#2563eb" stop-opacity="0.25" />
                  <stop offset="100%" stop-color="#2563eb" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="${chart.area}" fill="url(#energyFill-${safeId})" />
              <path d="${chart.line}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <div class="en-axis" style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: #64748b; padding: 0 8px 6px 8px;">
              <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
            </div>
          </div>
        </div>`;
      openModal('modal-detail');
    }



    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.style.display = 'none';
      });
    });

    /* ── API Actions ── */
    async function publishWhitelist() {
      try {
        const res = await fetch("/api/publish-whitelist", { method: "POST" });
        const j = await res.json();
        if (j.ok) {
          addLog("Đã yêu cầu đồng bộ Whitelist cho toàn mạng Gateway", "success");
        }
      } catch (err) { alert(`Lỗi: ${err}`); }
    }

    async function rebootGateway(id) {
      if (!confirm(`Bạn có chắc chắn muốn khởi động lại Gateway "${id}"?`)) return;
      try {
        const res = await fetch("/api/gw/reboot", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gw: id })
        });
        const j = await res.json();
        if (j.ok) addLog(`Đã gửi lệnh Reboot tới ${id}`, "info");
      } catch (err) { alert(`Lỗi: ${err}`); }
    }

    function openGwConfig(id) {
      const gw = gateways[id];
      if (!gw) return;
      document.getElementById('config-gw-id').value = id;
      document.getElementById('config-scan-interval').value = gw.scanInterval || 100;
      document.getElementById('config-scan-window').value = gw.scanWindow || 50;
      openModal('modal-gw-config');
    }

    async function saveGwConfig() {
      const id = document.getElementById('config-gw-id').value;
      const interval = document.getElementById('config-scan-interval').value;
      const window = document.getElementById('config-scan-window').value;

      try {
        const res = await fetch("/api/gw/config", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gw: id, interval: parseInt(interval), window: parseInt(window) })
        });
        const j = await res.json();
        if (j.ok) {
          addLog(`Đã cập nhật cấu hình quét cho ${id}`, "success");
          closeModal('modal-gw-config');
        }
      } catch (err) { alert(`Lỗi: ${err}`); }
    }

    async function addDevice() {
      const mac = document.getElementById('add-mac').value.trim().toUpperCase();
      const name = document.getElementById('add-name').value.trim();
      if (!mac) return alert('Vui lòng nhập MAC Address.');
      try {
        const res = await fetch("/api/add", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac, name, id: "" })
        });
        const j = await res.json();
        if (j.ok) {
          alert(`Đã thêm thiết bị!\nMAC: ${mac}\nTên: ${name || 'N/A'}`);
          document.getElementById('add-mac').value = '';
          document.getElementById('add-name').value = '';
          drafts.add.mac = ""; drafts.add.name = "";
          closeModal('modal-add');
        } else {
          alert(`Thêm thất bại: ${j.error || 'Unknown'}`);
        }
      } catch (err) { alert(`Lỗi: ${err}`); }
    }

    async function removeDevice() {
      const mac = document.getElementById('rm-mac').value.trim().toUpperCase();
      const name = document.getElementById('rm-name').value.trim();
      if (!mac) return alert('Vui lòng nhập MAC.');
      if (!confirm(`Xoá thiết bị ${name || 'không tên'} (MAC ${mac}) khỏi hệ thống?`)) return;
      const res = await fetch("/api/remove", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac })
      });
      const j = await res.json();
      if (j.ok) {
        document.getElementById('rm-mac').value = '';
        document.getElementById('rm-name').value = '';
        drafts.remove.mac = "";
        drafts.remove.name = "";
        closeModal('modal-remove');
      }
    }

    async function changePassword() {
      const current = document.getElementById('pwd-current').value;
      const newPwd = document.getElementById('pwd-new').value;
      const confirm_ = document.getElementById('pwd-confirm').value;

      if (!current || !newPwd || !confirm_) {
        return alert('Vui lòng điền đầy đủ thông tin.');
      }
      if (newPwd !== confirm_) {
        return alert('Mật khẩu mới không khớp.');
      }
      if (newPwd.length < 6) {
        return alert('Mật khẩu phải có ít nhất 6 ký tự.');
      }

      const username = sessionStorage.getItem("ble_user") || "admin";
      try {
        const res = await fetch("/api/users/change-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, oldPassword: current, newPassword: newPwd })
        });
        const j = await res.json();
        if (j.ok) {
          alert('Đổi mật khẩu thành công!');
          document.getElementById('pwd-current').value = '';
          document.getElementById('pwd-new').value = '';
          document.getElementById('pwd-confirm').value = '';
          closeModal('modal-change-password');
        } else {
          alert(`Lỗi: ${j.error}`);
        }
      } catch (err) { alert(`Lỗi kết nối: ${err.message}`); }
    }

    async function changePin() {
      const pinNew = document.getElementById('pin-new').value;
      const pinConfirm = document.getElementById('pin-confirm').value;

      if (!pinNew || !pinConfirm) {
        return alert('Vui lòng điền đầy đủ thông tin.');
      }
      if (pinNew !== pinConfirm) {
        return alert('PIN không khớp.');
      }
      if (!/^\d{4,6}$/.test(pinNew)) {
        return alert('PIN phải là 4-6 chữ số.');
      }

      const username = sessionStorage.getItem("ble_user") || "admin";
      try {
        const res = await fetch("/api/users/change-pin", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, newPin: pinNew })
        });
        const j = await res.json();
        if (j.ok) {
          alert('Cập nhật PIN thành công!');
          document.getElementById('pin-new').value = '';
          document.getElementById('pin-confirm').value = '';
          closeModal('modal-change-pin');
        } else {
          alert(`Lỗi: ${j.error}`);
        }
      } catch (err) { alert(`Lỗi kết nối: ${err.message}`); }
    }

    // async function pushOTA() {
    //   const fileInput = document.getElementById("ota-file");
    //   if (!fileInput.files || fileInput.files.length === 0) {
    //     return alert("Chưa chọn file firmware!");
    //   }

    //   const pin = await requirePin();
    //   if (!pin) return;

    //   const progressDiv = document.getElementById('ota-progress');
    //   const bar = document.getElementById('ota-bar');
    //   const pct = document.getElementById('ota-percent');
    //   progressDiv.style.display = 'block';

    //   const file = fileInput.files[0];
    //   const formData = new FormData();
    //   formData.append("firmware", file);
      
    //   const currentUser = sessionStorage.getItem('ble_user') || 'admin';
    //   formData.append("pin", pin);
    //   formData.append("requestUser", currentUser);

    //   try {
    //     const xhr = new XMLHttpRequest();
    //     xhr.upload.addEventListener("progress", e => {
    //       if (e.lengthComputable) {
    //         const p = Math.round((e.loaded / e.total) * 100);
    //         bar.style.width = p + "%";
    //         pct.textContent = p + "%";
    //       }
    //     });
    //     xhr.open("POST", "/api/ota", true);
    //     xhr.onload = () => {
    //       if (xhr.status === 200) {
    //         const j = JSON.parse(xhr.responseText);
    //         if (j.ok) {
    //           alert(`Cập nhật thành công Firmware ${file.name}`);
    //           progressDiv.style.display = 'none';
    //           bar.style.width = '0%';
    //           fileInput.value = '';
    //         } else {
    //           alert('Lỗi: ' + j.error);
    //           progressDiv.style.display = 'none';
    //         }
    //       } else {
    //         let err = `Lỗi HTTP ${xhr.status}`;
    //         try { err = JSON.parse(xhr.responseText).error || err; } catch(e){}
    //         alert('Lỗi: ' + err);
    //         progressDiv.style.display = 'none';
    //       }
    //     };
    //     xhr.onerror = () => {
    //       alert("Lỗi mạng khi upload firmware");
    //       progressDiv.style.display = 'none';
    //     }
    //     xhr.send(formData);
    //   } catch (err) {
    //     alert("Lỗi upload: " + err.message);
    //     progressDiv.style.display = 'none';
    //   }


    async function fetchUsers() {
      try {
        const res = await fetch("/api/users");
        const j = await res.json();
        if (j.ok && j.users) {
          const tbody = document.getElementById('sys-user-tbody');
          if (!tbody) return;
          const rows = j.users.map(u => {
            const ava = u.username.slice(0, 2).toUpperCase();
            const badge = u.status === 'online'
              ? '<span class="sys-badge online">● Hoạt động</span>'
              : '<span class="sys-badge offline">○ Ngoại tuyến</span>';
            const hideDel = u.username === 'admin' ? 'display:none;' : '';
            return `
              <tr>
                <td>
                  <div class="sys-user-cell">
                    <div class="sys-user-ava" style="background:linear-gradient(135deg,#059669,#047857);">${ava}</div>
                    <div>
                      <div class="sys-user-name">${u.username}</div>
                    </div>
                  </div>
                </td>
                <td><span class="role-tag role-${u.role}">${u.role}</span></td>
                <td>${badge}</td>
                <td class="sys-td-muted">${u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('vi-VN') : 'Chưa đăng nhập'}</td>
                <td style="text-align:right;">
                  <button class="sys-icon-btn danger" style="${hideDel}" title="Xóa" onclick="deleteUser('${u.username}')">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </td>
              </tr>
            `;
          });
          tbody.innerHTML = rows.join("");

          // Update static user stats headers
          const stats = document.querySelectorAll('.usr-summary-num');
          if (stats.length >= 3) {
            stats[0].innerText = j.users.length;
            stats[1].innerText = j.users.filter(u => u.status === 'online').length;
            stats[2].innerText = j.users.filter(u => u.status !== 'online').length;
          }

          let roleStats = { admin: 0, manager: 0, viewer: 0 };
          j.users.forEach(u => { if (roleStats[u.role] !== undefined) roleStats[u.role]++; else roleStats[u.role] = 1; });
          const total = j.users.length || 1;
          const roleHtml = `
            <div style="display:flex; align-items:center; gap:0.8rem;">
              <div style="width:8px; height:8px; border-radius:50%; background:#dc2626;"></div>
              <div style="flex:1;">
                <div style="font-size:0.85rem; font-weight:600;">Admin</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">${roleStats.admin} người</div>
              </div>
              <div style="font-size:0.9rem; font-weight:700; color:#dc2626;">${Math.round(roleStats.admin / total * 100)}%</div>
            </div>
            <div style="display:flex; align-items:center; gap:0.8rem;">
              <div style="width:8px; height:8px; border-radius:50%; background:#059669;"></div>
              <div style="flex:1;">
                <div style="font-size:0.85rem; font-weight:600;">Manager</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">${roleStats.manager} người</div>
              </div>
              <div style="font-size:0.9rem; font-weight:700; color:#059669;">${Math.round(roleStats.manager / total * 100)}%</div>
            </div>
            <div style="display:flex; align-items:center; gap:0.8rem;">
              <div style="width:8px; height:8px; border-radius:50%; background:#64748b;"></div>
              <div style="flex:1;">
                <div style="font-size:0.85rem; font-weight:600;">Viewer</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">${roleStats.viewer} người</div>
              </div>
              <div style="font-size:0.9rem; font-weight:700; color:#64748b;">${Math.round(roleStats.viewer / total * 100)}%</div>
            </div>`;

          const sidebarRoleContainer = document.querySelector('.users-grid-sidebar .sys-section-card:nth-child(1) > div:nth-child(2)');
          if (sidebarRoleContainer) sidebarRoleContainer.innerHTML = roleHtml;

          const onlineStat = document.getElementById('sys-sidebar-online');
          const offlineStat = document.getElementById('sys-sidebar-offline');
          if (onlineStat) onlineStat.innerText = j.users.filter(u => u.status === 'online').length;
          if (offlineStat) offlineStat.innerText = j.users.filter(u => u.status !== 'online').length;

        }
      } catch (err) {
        console.error("fetchUsers err", err);
      }
    }

    async function deleteUser(username) {
      if (!confirm("Bạn có chắc xoá tài khoản: " + username + "?")) return;
      const pin = await requirePin();
      if (!pin) return; // Cancelled

      try {
        const currentUser = sessionStorage.getItem('ble_user') || 'admin';
        const res = await fetch("/api/users/" + username, { 
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin, requestUser: currentUser })
        });
        const j = await res.json();
        if (j.ok) {
          if (typeof fetchUsers === 'function') fetchUsers();
          alert('Đã xoá tài khoản thành công!');
        } else {
          alert('Lỗi: ' + j.error);
        }
      } catch (e) { alert(e.message); }
    }

    async function submitUser() {
      const username = document.getElementById('user-new-username').value;
      const password = document.getElementById('user-new-password').value;
      const role = document.getElementById('user-new-role').value;
      if (!username) return alert('Nhập username');
      try {
        const res = await fetch("/api/users", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, role })
        });
        const j = await res.json();
        if (j.ok) {
          alert('Tạo người dùng thành công');
          document.getElementById('user-new-username').value = '';
          document.getElementById('user-new-password').value = '';
          closeModal('modal-add-user');
          fetchUsers();
        } else {
          alert('Lỗi: ' + j.error);
        }
      } catch (e) { alert(e.message); }
    }

    
    /* ── PIN Verification Helpers ── */
    let resolvePinPromise = null;
    function requirePin() {
      return new Promise((resolve, reject) => {
        document.getElementById('verify-pin-input').value = '';
        document.getElementById('verify-pin-error').style.display = 'none';       
        openModal('modal-verify-pin');
        setTimeout(() => document.getElementById('verify-pin-input').focus(), 100);
        resolvePinPromise = { resolve, reject };
      });
    }

    function cancelVerifyPin() {
      closeModal('modal-verify-pin');
      if (resolvePinPromise) {
        resolvePinPromise.resolve(null);
        resolvePinPromise = null;
      }
    }

    function submitVerifyPin() {
      const pin = document.getElementById('verify-pin-input').value;
      if (!pin) {
        document.getElementById('verify-pin-error').innerText = 'Vui lòng nhập PIN';
        document.getElementById('verify-pin-error').style.display = 'block';
        return;
      }
      closeModal('modal-verify-pin');
      if (resolvePinPromise) {
        resolvePinPromise.resolve(pin);
        resolvePinPromise = null;
      }
    }

    /* ── Reports Functions ── */
    function exportReport(type, format) {
      alert(`Đang khởi tạo xuất báo cáo ${type.toUpperCase()} định dạng ${format.toUpperCase()}...\nVui lòng chờ trong giây lát.`);
      setTimeout(() => {
        alert(`Đã chuẩn bị xong tệp báo cáo ${type}_${Date.now()}.${format}`);
      }, 1500);
    }

    function startPlayback() {
      const mac = document.getElementById('playback-mac').value;
      const date = document.getElementById('playback-date').value;
      if (!mac || !date) return alert('Vui lòng chọn thiết bị và ngày.');

      const area = document.getElementById('playback-area');
      const anim = document.getElementById('playback-anim');
      area.innerHTML = `<span>Đang mô phỏng hành trình cho ${mac} ngày ${date}...</span><div class="playback-line" id="playback-anim"></div>`;

      const lines = area.querySelector('.playback-line');
      lines.style.display = 'block';
      let pos = 0;
      const move = setInterval(() => {
        pos += 2;
        lines.style.left = pos + '%';
        if (pos >= 100) {
          clearInterval(move);
          area.innerHTML = `<span>Hành trình mô phỏng hoàn tất!</span>`;
        }
      }, 50);
    }

    function updatePlaybackList() {
      const select = document.getElementById('playback-mac');
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">Chọn thiết bị...</option>';
      Object.keys(devices).forEach(mac => {
        const name = devices[mac].meta?.name || mac;
        const opt = document.createElement('option');
        opt.value = mac;
        opt.textContent = name;
        select.appendChild(opt);
      });
      select.value = current;
    }

    /* ── Navigation Group Toggle ── */
    function toggleNavGroup(btn) {
      const submenu = btn.nextElementSibling;
      const chevron = btn.querySelector('.nav-chevron');
      if (submenu.style.display === 'none' || !submenu.style.display) {
        submenu.style.display = 'flex';
        chevron.style.transform = 'rotate(180deg)';
      } else {
        submenu.style.display = 'none';
        chevron.style.transform = 'rotate(0deg)';
      }
    }

    /* ── System Sub-Menu Switching ── */
    function switchSysMenu(tabName) {
      document.querySelectorAll('.sys-tab-content').forEach(c => c.classList.remove('active'));
      const el = document.getElementById(`sys-tab-${tabName}`);
      if (el) el.classList.add('active');

      document.querySelectorAll('.sys-menu-btn').forEach(btn => {
        if(btn.dataset.target === tabName) {
           btn.classList.add('active');
        } else {
           btn.classList.remove('active');
        }
      });
      // Try to hide old system tabs if they exist
      const sysTabs = document.querySelector('.sys-tabs');
      if (sysTabs) sysTabs.style.display = 'none';

      if (tabName === 'users') {
        if (typeof fetchUsers === 'function') fetchUsers();
      }
    }

    /* ── System Tab Switching (Legacy) ── */
    function switchSysTab(tabName, btn) {
      document.querySelectorAll('.sys-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sys-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const el = document.getElementById(`sys-tab-${tabName}`);
      if (el) el.classList.add('active');

      if (tabName === 'users') {
        if (typeof fetchUsers === 'function') fetchUsers();
      }
    }

    /* ── Sync system stats into sysinfo tab ── */
    function updateSysStats() {
      const ids = Object.keys(devices);
      const online = ids.filter(id => devices[id].meta?.status === 1).length;
      const offline = ids.length - online;
      const gwCount = Object.keys(gateways).length;
      const elTotal = document.getElementById('sys-stat-total');
      const elOnline = document.getElementById('sys-stat-online');
      const elOffline = document.getElementById('sys-stat-offline');
      const elGw = document.getElementById('sys-stat-gw');
      if (elTotal) elTotal.textContent = ids.length;
      if (elOnline) elOnline.textContent = online;
      if (elOffline) elOffline.textContent = offline;
      if (elGw) elGw.textContent = gwCount;
    }

    /* ── Sync profile info from API ── */
    async function syncProfileDisplay() {
      const user = sessionStorage.getItem('ble_user') || 'admin';
      const ava = user.slice(0, 2).toUpperCase();

      const els = {
        'sys-avatar-display': ava,
        'account-username': user,
        'account-role-display': user
      };

      for (let k in els) {
        let el = document.getElementById(k);
        if (el) el.textContent = els[k];
      }

      try {
        const res = await fetch("/api/users");
        const j = await res.json();
        if (j.ok && j.users) {
          const logUser = j.users.find(u => u.username === user);
          if (logUser) {
            const roleCap = logUser.role.charAt(0).toUpperCase() + logUser.role.slice(1);
            const lastAt = logUser.lastLogin ? new Date(logUser.lastLogin).toLocaleString('vi-VN') : '—';

            document.getElementById('sys-profile-name').textContent = logUser.username;
            document.getElementById('sys-session-time').textContent = lastAt;
            document.getElementById('sys-session-time-2').textContent = lastAt;
            document.getElementById('account-role').textContent = roleCap;
            document.getElementById('account-role-badge').textContent = roleCap;

            const elRoleTag = document.getElementById('sys-profile-role-tag');
            if (elRoleTag) {
              elRoleTag.className = `role-tag role-${logUser.role}`;
              elRoleTag.textContent = roleCap;
            }

            const elActList = document.getElementById('sys-activity-list');
            if (elActList) {
              if (!logUser.activities || logUser.activities.length === 0) {
                elActList.innerHTML = `<div style="padding:1.5rem; text-align:center; color:var(--text-faint); grid-column:1/-1;">Chưa có hoạt động nào</div>`;
              } else {
                const latest = logUser.activities.reduce((acc, act) => {
                  if (!acc) return act;
                  const accTs = acc.ts ? new Date(acc.ts).getTime() : 0;
                  const actTs = act.ts ? new Date(act.ts).getTime() : 0;
                  return actTs > accTs ? act : acc;
                }, null);

                if (!latest) {
                  elActList.innerHTML = `<div style="padding:1.5rem; text-align:center; color:var(--text-faint); grid-column:1/-1;">Chưa có hoạt động nào</div>`;
                } else {
                  const t = new Date(latest.ts);
                  const isToday = t.toDateString() === new Date().toDateString();
                  const timeStr = isToday
                    ? `Hôm nay, ${t.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                    : t.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric', year: 'numeric' });
                  elActList.innerHTML = `<div style="padding:0.6rem; background:#f3f4f6; border-radius:6px; font-size:0.8rem;">
                       <div style="color:var(--text-muted); margin-bottom:2px;">${timeStr}</div>
                       <div style="color:var(--text-main); font-weight:500;">${latest.msg}</div>
                     </div>`;
                }
              }
            }
          }
        }
      } catch (err) { console.error(err); }
    }

    async function syncFirmwareInfo() {
      try {
        const res = await fetch('/api/ota/version');
        const j = await res.json();
        if (j.ok) {
          const v = j.version;
          const els = ['fw-cur-ver', 'fw-new-ver', 'sys-ver-master'];
          els.forEach(id => {
            if (document.getElementById(id)) document.getElementById(id).textContent = v;
          });
        }
      } catch (err) { }
    }
    async function logout() {
      if (!confirm("Bạn có chắc chắn muốn đăng xuất không?")) return;
      const user = sessionStorage.getItem('ble_user') || 'admin';
      try {
        await fetch(`/api/users/${user}/activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg: 'Đăng xuất' })
        });
      } catch (e) { }
      sessionStorage.removeItem('ble_user');
      sessionStorage.removeItem('ble_auth');
      sessionStorage.removeItem('logged_in_recorded');
      location.reload();
    }

    async function loadState() {
      const user = sessionStorage.getItem('ble_user') || 'admin';
      if (!sessionStorage.getItem('logged_in_recorded')) {
        try {
          await fetch(`/api/users/${user}/activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg: 'Đăng nhập thành công', setOnline: true })
          });
          sessionStorage.setItem('logged_in_recorded', 'true');
        } catch (e) { }
      }

      try {
        const r = await fetch("/state");
        const j = await r.json();
        devices = j.devices || {};
        gateways = j.gateways || {};
        render();
        renderGateways();
        updatePlaybackList();
        if (typeof fetchUsers === 'function') fetchUsers();
        syncProfileDisplay();
        syncFirmwareInfo();
        setConnected(true);
      } catch (err) {
        console.error("Failed to load state", err);
        setConnected(false);
      }
    }

    searchInput.addEventListener('input', render);
    statusFilter.addEventListener('change', render);
    roomFilter.addEventListener('change', render);

    devSearchInput?.addEventListener('input', renderDevices);
    devStatusFilter?.addEventListener('change', renderDevices);
    devRoomFilter?.addEventListener('change', renderDevices);

    setInterval(() => { render(); renderDevices(); }, 5000);

    loadState();

    const es = new EventSource("/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "hello") { setConnected(true); }
      if (msg.type === "users_updated") {
        if (typeof fetchUsers === 'function') fetchUsers();
        if (typeof syncProfileDisplay === 'function') syncProfileDisplay();
      }
      if (msg.type === "gateway_update") {
        gateways[msg.gateway.id] = msg.gateway;
        renderGateways();
        if (noiseStats) noiseStats.innerText = `Thiết bị lạ quét được: ${msg.gateway.noise || 0}`;
        addLog(`Dữ liệu từ Gateway "${msg.gateway.id}" (Total: ${msg.gateway.totalDevices}, Noise: ${msg.gateway.noise || 0})`, "info");
        return;
      }
      if (msg.type === "update") {
        devices[msg.deviceId] = {
          currentRoom: msg.currentRoom,
          rooms: msg.rooms,
          updatedAt: msg.updatedAt,
          meta: msg.meta,
        };
        render();
        renderDevices();
      }
      if (msg.type === "delete") { delete devices[msg.deviceId]; render(); renderDevices(); }
      if (msg.type === "mgmt_response") {
        const seq = msg.data?.seq != null ? String(msg.data.seq) : "";
        const key = `${msg.action || ""}-${seq}`;
        const now = Date.now();
        if (key && key === lastMgmtKey && now - lastMgmtAt < 2000) return;
        lastMgmtKey = key; lastMgmtAt = now;
        alert(msg.data.status === 1 ? `${msg.action} thành công!` : `${msg.action} thất bại!`);
      }
    };
