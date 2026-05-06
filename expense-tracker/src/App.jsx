import { useState } from 'react'
import ExpenseForm from './components/ExpenseForm'
import ExpenseTable from './components/ExpenseTable'
import SearchBar from './components/SearchBar'

function App() {
  const [expenses, setExpenses] = useState([
    { id: 1, name: 'pineapple', category: 'fruit', amount: 100, description: 'Fresh pineapple', date: '2025-01-01' },
    { id: 2, name: 'milk', category: 'dairy', amount: 150, description: 'Full cream milk', date: '2025-01-02' },
    { id: 3, name: 'tropical', category: 'sweet', amount: 200, description: 'Tropical juice', date: '2025-01-03' },
    { id: 4, name: 'cx5', category: 'vehicle', amount: 250, description: 'Car fuel', date: '2025-01-04' },
    { id: 5, name: 'kcsmooth', category: 'alcohol', amount: 300, description: 'KC smooth drink', date: '2025-01-05' },
  ])
  const [searchTerm, setSearchTerm] = useState('')

  const addexpense = (expense) => {
    setExpenses([...expenses, expense])
  }

  function deleteExpense(id) {
    const updatedExpenses = expenses.filter((expense) => expense.id !== id)
    setExpenses(updatedExpenses)
  }

  const filteredExpenses = expenses.filter((expense) =>
    expense.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">EXPENSE TRACKER</h1>
        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
        <ExpenseForm addexpense={addexpense} />
        <ExpenseTable expenses={filteredExpenses} deleteExpense={deleteExpense} />
      </div>
    </div>
  )
}

export default App

