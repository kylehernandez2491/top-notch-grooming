import type { Appointment, AppointmentStatus } from '@shared/types';
import { api } from '@/api/client';
import { useUi } from '@/stores/ui';
import { buzz } from '@/utils/device';

/** The next step in the salon workflow for one tap on a phone or tablet. */
export function nextStep(status: AppointmentStatus): { status: AppointmentStatus; label: string } | null {
  switch (status) {
    case 'booked':
      return { status: 'checked-in', label: 'Check in' };
    case 'checked-in':
      return { status: 'in-progress', label: 'Start groom' };
    case 'in-progress':
      return { status: 'completed', label: 'Mark done' };
    default:
      return null;
  }
}

export function useStaffActions() {
  const ui = useUi();

  async function setStatus(appointment: Appointment, status: AppointmentStatus, finalPrice?: number): Promise<Appointment | null> {
    let note: string | undefined;
    if (status === 'cancelled') {
      const answer = await ui.confirm({
        title: `Cancel ${appointment.petName}'s appointment?`,
        message: `${appointment.ownerName} will get an email asking them to pick a new time.`,
        confirmLabel: 'Cancel and notify',
        cancelLabel: 'Keep it',
        danger: true,
        reasonLabel: 'Reason shown to the client',
      });
      if (!answer.confirmed) return null;
      note = answer.reason;
    }
    if (status === 'no-show') {
      const answer = await ui.confirm({
        title: `Mark ${appointment.petName} as a no-show?`,
        message: 'This counts toward the client’s no-show limit for online booking.',
        confirmLabel: 'Mark no-show',
        danger: true,
      });
      if (!answer.confirmed) return null;
    }
    try {
      const updated = await api.admin.setStatus(appointment.id, status, note, finalPrice);
      buzz();
      return updated;
    } catch (err) {
      ui.toast((err as Error).message, 'error');
      return null;
    }
  }

  return { setStatus };
}
