// ===================== ПРИМЕРЫ =====================
const EXAMPLES = [
{
  id: 'lr3', title: 'Карточка пользователя (форма, проверки ввода)',
  names: {
    firstname: { disp: 'f', desc: 'имя' }, lastname: { disp: 'l', desc: 'фамилия' }, middlename: { disp: 'm', desc: 'отчество' },
    old: { disp: 'a', desc: 'возраст' }, growth: { disp: 'h', desc: 'рост' }, weight: { disp: 'w', desc: 'вес' },
    choiceyes: { disp: 's', desc: 'признак обучения' }, hasnumsorspecsym: { disp: 'Спецсимволы', desc: '' },
    s: { disp: '', desc: 'проверяемая строка' }, result: { disp: 'r', desc: 'результат функции (true – есть цифры или спецсимволы)' }
  },
  code: `unit Unit1;

{$mode objfpc}{$H+}

interface

uses
  Classes, SysUtils, Forms, Controls, Graphics, Dialogs, StdCtrls,
  Unit2;

type

  { TForm1 }

  TForm1 = class(TForm)
    CreateButton: TButton;
    Growth: TEdit;
    GrowthLabel: TLabel;
    ChoiceYes: TRadioButton;
    ChoiceNo: TRadioButton;
    ChoiceLabel: TLabel;
    WeightLabel: TLabel;
    Weight: TEdit;
    Old: TComboBox;
    FirstName: TEdit;
    LastName: TEdit;
    MiddleName: TEdit;
    FirstNameLabel: TLabel;
    LastNameLabel: TLabel;
    MiddleNameLabel: TLabel;
    procedure CreateButtonClick(Sender: TObject);
  private

  public

  end;

var
  Form1: TForm1;

implementation

{$R *.lfm}

{ TForm1 }

procedure TForm1.CreateButtonClick(Sender: TObject);
var
  x: double;

function HasNumsOrSpecSym(const S: string): Boolean;
var
  i: integer;
begin
  Result := False;
  for i := 1 to Length(S) do
  if S[i] in ['0'..'9', '!', '@', '#', '$', '%', '^',
              '&', '*'] then
  begin
      Result := True;
      Break;
  end;
end;

begin
  if HasNumsOrSpecSym(FirstName.Text) then
  begin
    ShowMessage('Введено некорректное значение в имени!');
    FirstName.SetFocus;
    Exit;
  end;
  if HasNumsOrSpecSym(LastName.Text) then
  begin
    ShowMessage('Введено некорректное значение в фамилии!');
    LastName.SetFocus;
    Exit;
  end;
  if HasNumsOrSpecSym(MiddleName.Text) then
  begin
    ShowMessage('Введено некорректное значение в отчестве!');
    MiddleName.SetFocus;
    Exit;
  end;
  if StrToFloatDef(Growth.Text, 0) <= 0  then
  begin
    ShowMessage('Введено некорректное значение в росте!');
    Growth.SetFocus;
    Exit;
  end;
  if StrToFloatDef(Weight.Text, 0) <= 0  then
  begin
    ShowMessage('Введено некорректное значение в весе!');
    Weight.SetFocus;
    Exit;
  end;
  if Old.ItemIndex = -1 then
  begin
    ShowMessage('Выберите возраст!');
    Old.SetFocus;
    Exit;
  end;
  Form2.SetData(
    FirstName.Text,
    LastName.Text,
    MiddleName.Text,
    Weight.Text,
    Growth.Text,
    Old.Text,
    ChoiceYes.Checked
  );
  Form2.ShowModal;
end;

end.
`},
{
  id: 'branch', title: 'Кусочная функция (каскад условий)',
  names: {},
  code: `program PiecewiseFunction;
var
  x, y: real;
begin
  write('Введите x: ');
  readln(x);
  if x < 0 then
    y := Power(x, 4) + 1
  else if x > pi / 2 then
    y := Power(x, 5) - 2.1
  else
    y := Sin(Power(x, 6));
  writeln('y = ', y:0:4);
end.
`},
{
  id: 'while', title: 'Сравнение слов (цикл с предусловием, функция)',
  names: { hasrepeats: { disp: 'Повторы', desc: '' }, s: { disp: '', desc: 'проверяемое слово' }, result: { disp: 'r', desc: 'результат функции (true – есть повторы литер)' } },
  code: `unit Unit1;

interface

uses Classes, SysUtils, Forms, Controls, StdCtrls, Dialogs;

type
  TForm1 = class(TForm)
    Edit1: TEdit;
    Edit2: TEdit;
    Label3: TLabel;
    Button1: TButton;
    procedure Button1Click(Sender: TObject);
  end;

var
  Form1: TForm1;

implementation

function HasRepeats(const s: string): Boolean;
var
  i, j, n: integer;
begin
  Result := False;
  n := Length(s);
  for i := 1 to n - 1 do
    for j := i + 1 to n do
      if s[i] = s[j] then
      begin
        Result := True;
        Exit;
      end;
end;

procedure TForm1.Button1Click(Sender: TObject);
var
  x, y: string;
  eq: boolean;
  i: integer;
begin
  x := Edit1.Text;
  y := Edit2.Text;
  if HasRepeats(x) or HasRepeats(y) then
  begin
    ShowMessage('Слова не должны содержать повторяющихся букв');
    Exit;
  end;
  eq := Length(x) = Length(y);
  i := 1;
  while eq and (i <= Length(x)) do
  begin
    eq := Pos(x[i], y) > 0;
    i := i + 1;
  end;
  Label3.Caption := BoolToStr(eq, 'Да', 'Нет');
end;

end.
`},
{
  id: 'matrix', title: 'Матрица (циклы со счётчиком, перенос)',
  names: {},
  code: `program Matrix;
const
  N = 7;
var
  a: array[1..N, 1..N] of real;
  i, j: integer;
begin
  for j := 1 to N do
    a[1, j] := 2 * j + 3;
  for j := 1 to N do
    a[2, j] := j - 3 / (2 + 1 / j);
  for i := 3 to N do
    for j := 1 to N do
      a[i, j] := a[i - 1, j] + a[i - 2, j];
  for i := 1 to N do
  begin
    for j := 1 to N do
      write(a[i, j]:9:2);
    writeln;
  end;
end.
`},
{
  id: 'digits', title: 'Сумма цифр (repeat, while, case)',
  names: {},
  code: `program DigitSum;
var
  n, s, d, k: integer;
begin
  repeat
    write('Введите натуральное число: ');
    readln(n);
  until n > 0;
  s := 0;
  k := 0;
  while n > 0 do
  begin
    d := n mod 10;
    s := s + d;
    n := n div 10;
    k := k + 1;
  end;
  case k of
    1: writeln('Однозначное число');
    2, 3: writeln('Сумма цифр: ', s);
  else
    writeln('Сумма ', k, ' цифр: ', s);
  end;
end.
`},
{
  id: 'triangle', title: 'Углы треугольника (проверка данных, функции)',
  names: {
    distance: { disp: 'Длина', desc: '' }, angle: { disp: 'Угол', desc: '' },
    xa: { disp: 'x_A', desc: '' }, ya: { disp: 'y_A', desc: '' }, xb: { disp: 'x_B', desc: '' }, yb: { disp: 'y_B', desc: '' },
    xc: { disp: 'x_C', desc: '' }, yc: { disp: 'y_C', desc: '' }, alpha: { disp: 'α', desc: '' }, beta: { disp: 'β', desc: '' }, gamma: { disp: 'γ', desc: '' },
    x1: { disp: 'x_1', desc: '' }, y1: { disp: 'y_1', desc: '' }, x2: { disp: 'x_2', desc: '' }, y2: { disp: 'y_2', desc: '' }
  },
  code: `program Triangle;
var
  xA, yA, xB, yB, xC, yC, S, a, b, c, alpha, beta, gamma: double;

function Distance(x1, y1, x2, y2: double): double;
begin
  Result := Sqrt(Sqr(x1 - x2) + Sqr(y1 - y2));
end;

function Angle(a, b, c: double): double;
begin
  Result := 180 / pi * ArcCos((b * b + c * c - a * a) / (2 * b * c));
end;

begin
  readln(xA, yA, xB, yB, xC, yC);
  S := (xB - xA) * (yC - yA) - (yB - yA) * (xC - xA);
  if Abs(S) < 1E-12 then
  begin
    writeln('Ошибка: точки лежат на одной прямой');
    Halt;
  end;
  a := Distance(xB, yB, xC, yC);
  b := Distance(xA, yA, xC, yC);
  c := Distance(xA, yA, xB, yB);
  alpha := Angle(a, b, c);
  beta := Angle(b, a, c);
  gamma := Angle(c, a, b);
  writeln(alpha:0:2, ' ', beta:0:2, ' ', gamma:0:2);
end.
`}
];
