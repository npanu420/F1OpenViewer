/**
 * The current grid, offered as favourites during the first-run setup, before any catalog is
 * available. Names are the ones the F1 TV onboard streams use: favourites are matched by name.
 */
export interface GridDriver {
  name: string;
  team: string;
  number: number;
  /** Team colour, only used as an accent. */
  colour: string;
}

export const CURRENT_GRID: readonly GridDriver[] = [
  { name: 'Lando Norris', team: 'McLaren', number: 1, colour: '#FF8000' },
  { name: 'Oscar Piastri', team: 'McLaren', number: 81, colour: '#FF8000' },
  { name: 'Max Verstappen', team: 'Red Bull Racing', number: 3, colour: '#3671C6' },
  { name: 'Liam Lawson', team: 'Red Bull Racing', number: 30, colour: '#3671C6' },
  { name: 'Charles Leclerc', team: 'Ferrari', number: 16, colour: '#E8002D' },
  { name: 'Lewis Hamilton', team: 'Ferrari', number: 44, colour: '#E8002D' },
  { name: 'George Russell', team: 'Mercedes', number: 63, colour: '#27F4D2' },
  { name: 'Andrea Kimi Antonelli', team: 'Mercedes', number: 12, colour: '#27F4D2' },
  { name: 'Fernando Alonso', team: 'Aston Martin', number: 14, colour: '#229971' },
  { name: 'Lance Stroll', team: 'Aston Martin', number: 18, colour: '#229971' },
  { name: 'Pierre Gasly', team: 'Alpine', number: 10, colour: '#00A1E8' },
  { name: 'Franco Colapinto', team: 'Alpine', number: 43, colour: '#00A1E8' },
  { name: 'Alexander Albon', team: 'Williams', number: 23, colour: '#1868DB' },
  { name: 'Carlos Sainz', team: 'Williams', number: 55, colour: '#1868DB' },
  { name: 'Yuki Tsunoda', team: 'Racing Bulls', number: 22, colour: '#6692FF' },
  { name: 'Arvid Lindblad', team: 'Racing Bulls', number: 41, colour: '#6692FF' },
  { name: 'Nico Hulkenberg', team: 'Audi', number: 27, colour: '#F50537' },
  { name: 'Gabriel Bortoleto', team: 'Audi', number: 5, colour: '#F50537' },
  { name: 'Esteban Ocon', team: 'Haas F1 Team', number: 31, colour: '#9C9FA2' },
  { name: 'Oliver Bearman', team: 'Haas F1 Team', number: 87, colour: '#9C9FA2' },
  { name: 'Sergio Perez', team: 'Cadillac', number: 11, colour: '#B6BABD' },
  { name: 'Valtteri Bottas', team: 'Cadillac', number: 77, colour: '#B6BABD' },
];
