let teams = [];
let currentTeamId = null;
let refreshTimer = null;

const teamSelect = document.getElementById('team-select');
const teamName = document.getElementById('team-name');
const memberCount = document.getElementById('member-count');
const inviteCode = document.getElementById('invite-code');
const btnCopy = document.getElementById('btn-copy');
const membersBody = document.getElementById('members-body');
const lastRefresh = document.getElementById('last-refresh');

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

async function loadTeams() {
  try {
    teams = await window.electronAPI.getMyTeams();
    teamSelect.innerHTML = '';
    for (const t of teams) {
      if (t.role !== 'admin') continue;
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      teamSelect.appendChild(opt);
    }
    if (teamSelect.options.length > 0) {
      currentTeamId = teamSelect.value;
      updateTeamHeader();
      loadMembers();
    } else {
      membersBody.innerHTML = '<tr><td colspan="7" class="empty-state">No admin teams found</td></tr>';
    }
  } catch {
    membersBody.innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load teams</td></tr>';
  }
}

function updateTeamHeader() {
  const team = teams.find((t) => t.id === currentTeamId);
  if (!team) return;
  teamName.textContent = team.name;
  inviteCode.textContent = team.invite_code;
}

async function loadMembers() {
  if (!currentTeamId) return;
  try {
    const members = await window.electronAPI.getTeamMembers(currentTeamId);
    memberCount.textContent = members.length + ' member' + (members.length !== 1 ? 's' : '');

    if (members.length === 0) {
      membersBody.innerHTML = '<tr><td colspan="7" class="empty-state">No members</td></tr>';
      return;
    }

    membersBody.innerHTML = members.map((m) => {
      const s = m.latest_snapshot || {};
      const todayTokens = (s.session_input_tokens || 0) + (s.session_output_tokens || 0);
      return `<tr>
        <td class="cell-name">${escapeHtml(m.name)}</td>
        <td class="cell-email">${escapeHtml(m.email)}</td>
        <td class="cell-pct">${s.session_pct != null ? s.session_pct + '%' : '—'}</td>
        <td class="cell-pct">${s.week_all_pct != null ? s.week_all_pct + '%' : '—'}</td>
        <td class="cell-tokens">${formatTokens(todayTokens)}</td>
        <td class="cell-time">${timeAgo(s.last_active || s.recorded_at)}</td>
        <td><span class="role-badge ${m.role}">${m.role}</span></td>
      </tr>`;
    }).join('');

    lastRefresh.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch {
    membersBody.innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load members</td></tr>';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

teamSelect.addEventListener('change', () => {
  currentTeamId = teamSelect.value;
  updateTeamHeader();
  loadMembers();
});

btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(inviteCode.textContent).then(() => {
    btnCopy.textContent = 'Copied!';
    setTimeout(() => { btnCopy.textContent = 'Copy'; }, 1500);
  });
});

// Auto-refresh every 30s
loadTeams();
refreshTimer = setInterval(loadMembers, 30000);
