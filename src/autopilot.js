import { columnAt, waterTopAt, waterBottomAt } from './world.js';
import { isWarehouseDelivered } from './engine.js';

// 确定性自动驾驶：脱困 -> 紧急避岩 -> 靠近仓库 -> 沿河道中心路径点前进。
export function runAutopilot(world, state) {
  const boat = state.boat;
  if (state.status !== 'running') {
    return { propel: false, forward: false, backward: false, steer: 0, throttle: 0 };
  }

  if (boat.grounded) {
    return { propel: false, forward: false, backward: true, reverse: true, steer: 0, throttle: 0.6 };
  }

  // 失速恢复：船头偏出朝右半圆时，原地回正不推进。
  if (boat.angle > 1.0 || boat.angle < -1.0 ||
      (state.recovering && Math.abs(boat.angle) > 0.8)) {
    state.recovering = true;
    // 用最短转角把角度拉回 0；舵量与当前角度成正比，避免跨越零点振荡。
    const recoverySteer = Math.max(-0.5, Math.min(0.5, boat.angle * 0.5));
    return {
      propel: false,
      forward: false,
      backward: false,
      steer: recoverySteer,
      throttle: 0,
    };
  }
  state.recovering = false;

  // 正前方极近岩石：倒车并向开阔一侧转向。
  for (const rock of world.obstacles) {
    const dx = rock.x - boat.x;
    const dy = rock.y - boat.y;
    if (dx > -10 && dx < 64 && Math.abs(dy) < rock.r + 28) {
      return {
        propel: false,
        forward: false,
        backward: true,
        reverse: true,
        steer: dy > 0 ? -0.7 : 0.7,
        throttle: 0.7,
      };
    }
  }

  let targetY = world.centers[Math.min(world.COLS - 1, columnAt(world, boat.x) + 2)];
  let aimX = 96;
  let nearWarehouse = false;
  let warehouseTarget = null;

  // 近距离未送达仓库优先，直接瞄准码头。
  for (const wh of world.warehouses) {
    if (isWarehouseDelivered(state, wh.id)) continue;
    const dx = wh.x - boat.x;
    if (dx > -120 && dx < 720) {
      warehouseTarget = wh;
      targetY = wh.y;
      aimX = Math.max(40, dx);
      nearWarehouse = dx < 320;
      break;
    }
  }

  // 中距离岩石绕行：选择更开阔的一侧。
  const top = waterTopAt(world, boat.x + 96);
  const bottom = waterBottomAt(world, boat.x + 96);
  for (const rock of world.obstacles) {
    const dx = rock.x - boat.x;
    if (!warehouseTarget && dx > 10 && dx < 210 && Math.abs(rock.y - boat.y) < rock.r + 96) {
      const roomTop = rock.y - top;
      const roomBottom = bottom - rock.y;
      targetY = roomTop > roomBottom ? rock.y - rock.r - 44 : rock.y + rock.r + 44;
    }
  }

  const command = steerToward(boat, targetY, aimX);
  if (nearWarehouse) command.throttle = Math.min(command.throttle, 0.45);
  // 靠近仓库但纵向还没对准时减速，避免冲过投递圈。
  if (warehouseTarget && Math.abs(warehouseTarget.y - boat.y) > 46) {
    command.throttle = Math.min(command.throttle, 0.18);
  }
  return command;
}

function steerToward(boat, targetY, aimX) {
  const desired = Math.atan2(targetY - boat.y, aimX);
  let diff = desired - boat.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  // 期望航向限制在朝右的 ±70°，从源头杜绝角度环绕失稳。
  diff = Math.max(-1.2, Math.min(1.2, diff));
  if (Math.abs(diff) < 0.08) diff = 0;

  const steer = Math.max(-0.7, Math.min(0.7, diff));
  // 大角度时几乎停船，先转向再前进，避免冲出航线。
  const throttle = Math.max(0.2, 0.85 - Math.abs(diff) * 0.9);
  return { propel: true, forward: true, backward: false, steer, throttle };
}
