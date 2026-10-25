use super::protocol::{Atom, Event, Held, LEASE_MS, atoms};
use std::collections::BTreeSet;

pub trait Injector {
    fn send(&mut self, atom: Atom) -> bool;
    fn local_takeover(&self, _held: Held) -> bool {
        false
    }
    fn locally_held(&self, _held: Held) -> bool {
        false
    }
}
#[derive(Clone, Debug)]
struct Lease {
    grant: String,
    generation: u64,
    deadline_ms: u64,
}

#[derive(Default)]
pub struct Engine {
    lease: Option<Lease>,
    floor: u64,
    owned: BTreeSet<Held>,
}
impl Engine {
    pub fn begin(&mut self, grant: &str, generation: u64, now: u64) -> Result<(), &'static str> {
        if generation <= self.floor {
            return Err("invalidated_generation");
        }
        if self.lease.is_some() {
            return Err("controller_busy");
        }
        if !self.owned.is_empty() {
            return Err("cleanup_pending");
        }
        self.lease = Some(Lease {
            grant: grant.to_owned(),
            generation,
            deadline_ms: now + LEASE_MS,
        });
        Ok(())
    }
    fn validate(&self, grant: &str, generation: u64, now: u64) -> Result<(), &'static str> {
        match &self.lease {
            Some(lease)
                if lease.grant == grant
                    && lease.generation == generation
                    && generation > self.floor
                    && now < lease.deadline_ms =>
            {
                Ok(())
            }
            _ => Err("inactive_lease"),
        }
    }
    pub fn heartbeat(
        &mut self,
        grant: &str,
        generation: u64,
        now: u64,
    ) -> Result<(), &'static str> {
        self.validate(grant, generation, now)?;
        self.lease.as_mut().unwrap().deadline_ms = now + LEASE_MS;
        Ok(())
    }
    pub fn invalidate(&mut self, generation: u64, injector: &mut impl Injector) {
        self.floor = self.floor.max(generation);
        if self
            .lease
            .as_ref()
            .is_some_and(|lease| lease.generation <= self.floor)
        {
            self.lease = None;
        }
        if self.lease.is_none() {
            self.release(injector);
        }
    }
    pub fn stop(&mut self, injector: &mut impl Injector) {
        if let Some(lease) = self.lease.take() {
            self.floor = self.floor.max(lease.generation);
        }
        self.release(injector);
    }
    pub fn tick(&mut self, now: u64, safe: bool, injector: &mut impl Injector) {
        if !safe
            || self
                .lease
                .as_ref()
                .is_some_and(|lease| now >= lease.deadline_ms)
        {
            self.stop(injector);
        }
        if self.lease.is_none() {
            self.release(injector);
        }
    }
    fn release(&mut self, injector: &mut impl Injector) {
        // Keep unsuccessful releases owned and retry on the next watchdog pass.
        self.owned
            .retain(|held| !injector.local_takeover(*held) && !injector.send(Atom::release(*held)));
    }
    pub fn clean(&self) -> bool {
        self.owned.is_empty()
    }
    pub fn active(&self) -> bool {
        self.lease.is_some()
    }
    pub fn generation(&self) -> Option<u64> {
        self.lease.as_ref().map(|lease| lease.generation)
    }
    pub fn input(
        &mut self,
        grant: &str,
        generation: u64,
        event: &Event,
        now: u64,
        injector: &mut impl Injector,
    ) -> Result<(), &'static str> {
        self.validate(grant, generation, now)?;
        let atoms = atoms(event)?;
        // Validate the entire logical gesture before its leading cursor move.
        let mut prospective = self.owned.clone();
        for atom in &atoms {
            if let Some((held, up)) = atom.held() {
                if (up && !prospective.contains(&held))
                    || (!up && !prospective.contains(&held) && injector.locally_held(held))
                {
                    self.stop(injector);
                    return Err("input_not_owned");
                }
                if up {
                    prospective.remove(&held);
                } else {
                    prospective.insert(held);
                }
                if prospective.len() > 35 {
                    self.stop(injector);
                    return Err("held_input_limit");
                }
            }
        }
        for atom in atoms {
            if let Some((held, up)) = atom.held() {
                if up && !self.owned.contains(&held) {
                    self.stop(injector);
                    return Err("input_not_owned");
                }
                if !up && !self.owned.contains(&held) && injector.locally_held(held) {
                    self.stop(injector);
                    return Err("local_input_priority");
                }
                if !up && !self.owned.contains(&held) && self.owned.len() >= 35 {
                    self.stop(injector);
                    return Err("held_input_limit");
                }
            }
            if !injector.send(atom) {
                self.stop(injector);
                return Err("system_input_rejected");
            }
            if let Some((held, up)) = atom.held() {
                if up {
                    self.owned.remove(&held);
                } else {
                    self.owned.insert(held);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Fake {
        sent: Vec<Atom>,
        fail_at: Option<usize>,
        local: bool,
        takeover: BTreeSet<Held>,
    }
    impl Injector for Fake {
        fn send(&mut self, atom: Atom) -> bool {
            self.sent.push(atom);
            self.fail_at != Some(self.sent.len())
        }
        fn locally_held(&self, _: Held) -> bool {
            self.local
        }
        fn local_takeover(&self, held: Held) -> bool {
            self.takeover.contains(&held)
        }
    }
    fn key(pressed: bool) -> Event {
        Event::Key {
            code: "ControlLeft".into(),
            pressed,
            repeat: false,
        }
    }
    #[test]
    fn only_bound_generation_executes_and_revoke_releases_owned() {
        let (mut engine, mut fake) = (Engine::default(), Fake::default());
        engine.begin("grant", 1, 0).unwrap();
        assert!(engine.input("wrong", 1, &key(true), 1, &mut fake).is_err());
        assert!(fake.sent.is_empty());
        engine.input("grant", 1, &key(true), 1, &mut fake).unwrap();
        engine.invalidate(1, &mut fake);
        assert_eq!(
            fake.sent,
            vec![Atom::Key(0x1d, false, false), Atom::Key(0x1d, false, true)]
        );
        assert!(engine.begin("grant", 1, 2).is_err());
        assert!(engine.input("grant", 1, &key(true), 2, &mut fake).is_err());
    }
    #[test]
    fn lease_timeout_and_parent_loss_release_without_network() {
        for safe in [true, false] {
            let (mut engine, mut fake) = (Engine::default(), Fake::default());
            engine.begin("grant", 1, 0).unwrap();
            engine.input("grant", 1, &key(true), 1, &mut fake).unwrap();
            engine.tick(if safe { 1000 } else { 10 }, safe, &mut fake);
            assert!(engine.clean());
            assert!(engine.heartbeat("grant", 1, 1001).is_err());
            assert_eq!(fake.sent.last(), Some(&Atom::Key(0x1d, false, true)));
        }
    }
    #[test]
    fn old_invalidation_floor_does_not_release_an_active_newer_drag() {
        let (mut engine, mut fake) = (Engine::default(), Fake::default());
        engine.begin("grant", 3, 0).unwrap();
        engine.input("grant", 3, &key(true), 1, &mut fake).unwrap();
        engine.invalidate(2, &mut fake);
        assert_eq!(fake.sent.len(), 1);
        assert!(engine.active());
    }
    #[test]
    fn partial_unicode_failure_releases_previous_successful_down() {
        let (mut engine, mut fake) = (
            Engine::default(),
            Fake {
                fail_at: Some(2),
                ..Fake::default()
            },
        );
        engine.begin("grant", 1, 0).unwrap();
        assert!(
            engine
                .input("grant", 1, &Event::Text { text: "中".into() }, 1, &mut fake)
                .is_err()
        );
        assert_eq!(fake.sent.last(), Some(&Atom::Unicode('中' as u16, true)));
        assert!(engine.clean());
    }
    #[test]
    fn release_failure_remains_owned_and_prevents_new_grant_until_released() {
        let (mut engine, mut fake) = (Engine::default(), Fake::default());
        engine.begin("grant", 1, 0).unwrap();
        engine.input("grant", 1, &key(true), 1, &mut fake).unwrap();
        fake.fail_at = Some(2);
        engine.stop(&mut fake);
        assert!(!engine.clean());
        assert!(engine.begin("new", 2, 2).is_err());
        engine.tick(3, true, &mut fake);
        assert!(engine.clean());
        engine.begin("new", 2, 3).unwrap();
    }
    #[test]
    fn physical_local_key_is_never_acquired_or_released() {
        let (mut engine, mut fake) = (
            Engine::default(),
            Fake {
                local: true,
                ..Fake::default()
            },
        );
        engine.begin("grant", 1, 0).unwrap();
        assert!(engine.input("grant", 1, &key(true), 1, &mut fake).is_err());
        assert!(fake.sent.is_empty());
        assert!(engine.clean());
    }
    #[test]
    fn later_physical_takeover_keeps_local_key_and_mouse_down_but_releases_other_remote_keys() {
        use super::super::protocol::Button;
        for taken in [Held::Key(0x1d, false), Held::Button(Button::Left)] {
            let (mut engine, mut fake) = (Engine::default(), Fake::default());
            engine.begin("grant", 1, 0).unwrap();
            let down = if taken == Held::Key(0x1d, false) {
                key(true)
            } else {
                Event::Button {
                    button: Button::Left,
                    pressed: true,
                    point: super::super::protocol::Point {
                        x_physical: 10.0,
                        y_physical: 10.0,
                        x_dip: 10.0,
                        y_dip: 10.0,
                        absolute_x: 100,
                        absolute_y: 100,
                    },
                }
            };
            engine.input("grant", 1, &down, 1, &mut fake).unwrap();
            engine
                .input(
                    "grant",
                    1,
                    &Event::Key {
                        code: "KeyA".into(),
                        pressed: true,
                        repeat: false,
                    },
                    2,
                    &mut fake,
                )
                .unwrap();
            fake.sent.clear();
            fake.takeover.insert(taken);
            engine.stop(&mut fake);
            assert!(engine.clean());
            assert!(!engine.active());
            assert_eq!(fake.sent, vec![Atom::Key(0x1e, false, true)]);
            fake.takeover.clear();
            engine.tick(2, true, &mut fake);
            assert_eq!(
                fake.sent.len(),
                1,
                "ownership was handed back, never release it later"
            );
        }
    }
    #[test]
    fn fixed_protocol_rejects_shell_and_bounds() {
        assert!(serde_json::from_str::<Event>(r#"{"kind":"shell","command":"whoami"}"#).is_err());
        assert!(
            atoms(&Event::Key {
                code: "LaunchApp1".into(),
                pressed: true,
                repeat: false
            })
            .is_err()
        );
        assert!(
            atoms(&Event::Text {
                text: "a\0b".into()
            })
            .is_err()
        );
        assert_eq!(
            super::super::protocol::scan_code("ArrowLeft"),
            Some((0x4b, true))
        );
        assert_eq!(
            super::super::protocol::scan_code("KeyA"),
            Some((0x1e, false))
        );
    }
}
